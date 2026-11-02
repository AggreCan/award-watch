"""Static JSON export: the files the site serves as assets.

Why static: a read-heavy public dataset costs nothing per row when page views
read files. The site ships the data as JSON files beside the Worker (static
assets are free to serve), list pages filter in the browser, and a detail page
reads one small shard. The database stays on the operator's side.

The layout is the contract in CLAUDE.md "Static export layout"; the site's
loaders (site/src/data.ts) check every field they render and answer "not
published" for a file that does not read, so a shape change here goes with a
change there. Output tree (under data/out/static):

  stats.json                    counts, today's notices, closing soon, recent awards, the year's top
                                organizations by awards value, the last runs, the source files read
                                (source_files: one row per file read and one per source never read, each
                                with last_read, last_modified as an ISO instant, last_modified_http as the
                                publisher sent it, and loaded)
  tenders/open.json             every notice open on the data date as a list row (read by the browser only)
  tenders/open-first.json       the 50 open notices closing soonest, the number open, and the facet
                                counts over all of them (what /tenders renders on the server)
  tenders/new/<day>.json        the notices first seen on each of the last 30 days
  tenders/<abc>.json            every notice in the database, detail form, sharded on the reference
  contracts/<abc>.json          award notices and contract history records, detail form, same sharding,
                                keyed "award:<reference>" and "history:<reference>"
  awards/recent.json            the 500 most recently published award notices
  awards/<year>/index.json      a year's page count and row count
  awards/<year>/<n>.json        the year's award notices, newest award date first, 500 to a page
  profiles/<abc>.json           organization profiles, sharded on the id's characters 5 to 7
  aliases/<abc>.json            retired organization id -> the live id that took its records: retired by a
                                normalization change (migrate.py) or merged into another organization
                                (merges.py); the site redirects a missing profile by it
  directory/...                 organizations A to Z by province (directory.py)
  buyers/index.json, buyers/<id>.json   the listed buyers (export.LISTED_BUYER): those with an open notice,
                                an award notice, a contract history record, a published contract or a grant
  buyers/aliases.json           {"aliases": {old buyer id: listed buyer id}}: the buyer ids the buyers stage
                                retired (buyer_aliases, chains followed), for a permanent redirect; an alias
                                whose target is not listed, or whose old id is listed again, is left out
  categories/index.json, categories/<nn>.json     the 57 UNSPSC segments
  rankings/all.json, rankings/<year>.json
  expiring/index.json           the expiring-contracts radar (expiring.py): the three windows' counts and
                                totals, the top buyers, the segments
  expiring/<window>/index.json, expiring/<window>/<n>.json   a window's rows, soonest end first, 500 a page
                                (buyer files and profiles carry their own first 25 as "expiring")
  feeds/...                     Atom feeds (feeds.py)
  sitemaps/sitemap-<n>.xml, sitemaps/index.xml

Open and closed. CanadaBuys' open-notice file keeps listing some notices for
months after they close. A notice's status in the export is its status on the
data date (normalize.tender_status_on): an open notice whose closing day (the
date part of tenderClosingDate, in UTC) is before the data date is "closed",
and the status its file states travels beside it as source_status (tender
details, and the rows of tenders/new). Only a notice open on the data date is
in tenders/open.json, tenders/open-first.json, the counts and closing-soon
list of stats.json, a buyer's or a segment's open notices, open-tenders.csv
and the tenders feed (feeds.py). A notice closing on the data date is open.

Buyers. A record's buyer_id names a listed buyer or is null; the buyer's names
stay on the record either way. A record whose buyer spelling named no
institution (sources/buyers.non_institution) has no buyer, and its spelling is
shown only when it neither names nor locates a person
(buyers.public_spelling).

Values and totals. A value the source did not publish is null, never 0, on
every row, and no total adds it; beside each total a count of the records it
left out that way: n_no_value on every {n, total} object (the years of a
profile and of a buyer, a profile's top buyers, the rankings' organizations
and buyers, the year's top organizations in stats.json, the buyers' and
categories' top organizations, a category's years, the radar's windows, its
index pages, its by_buyer and by_segment rows and the "expiring" part of a
buyer file or a profile), n_<source>_no_value beside total_<source> on a
profile's organization block and in buyers/index.json, awards_n_no_value and
awards_year_n_no_value in categories/index.json. A value value_checks.py
flagged for checking stays on its row with value_flag "check" (award and
history list rows and details, a profile's published contracts, the radar's
rows) and no total adds it either; a profile's value_check {source: n} counts
them, as non_cad counts the contracts in another currency.

Profiles also carry "<source>_loaded": false for a source never read (the
lobbying registry has refused every request so far), so a count of 0 there
reads as not loaded rather than none; a source that was read carries no key.
Radar rows carry client_buyer_id, client_buyer_name and client_buyer_name_fr,
the client department expiring.py names, beside buyer_id (for an award notice
that is PSPC).

References in URLs and file names. The site takes a reference from its URL
only when it reads as [A-Za-z0-9._-]{1,80}, and a few CanadaBuys references do
not ("23240-220799/001/IM", "SSC-26-00035339:T"). Each is exported under its
URL form (url_reference: dollar signs dropped, any other run of characters
outside that set made one hyphen), and the published form travels beside it
as reference_published whenever the two differ. CanadaBuys serves a notice at
its published reference in lower case with the colons removed and each "/"
kept as a path separator (feeds.notice_path; "SSC-26-00040563:A:1" is at
.../award-notice/ssc-26-00040563a1), which is what a link builds from it.
Shards are sha1 of the URL form in lower case, its first three hex digits,
which is what the site computes from the address it was asked for.

What never leaves the database: the contacts on tender and award notices
(contact_name, contact_email, contact_phone), the buyer_name column of the
published contracts (a public servant's name), supplier street addresses and
postal codes, and anything about a supplier, vendor, recipient or client the
loaders withheld as a private individual. A withheld supplier is exported as
supplier null with supplier_withheld true, and its record links to no
organization. The publishers' own prose (titles, descriptions, comments)
sometimes carries an officer's email address or telephone number; _dump
passes every free-text field through export.scrub before a file is written.

Every file is written deterministically (sorted keys and rows, nothing taken
from the clock but the data date), so an unchanged shard keeps its bytes and
the deploy skips it.
"""

from __future__ import annotations

import csv
import hashlib
import heapq
import json
import logging
import re
import shutil
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Callable, Collection, Iterable, Sequence
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.sax.saxutils import escape

from . import config, directory, expiring, indicators, organizations, value_checks
from .db import get_meta, log_run, set_meta
from .export import listed_buyer_ids, register_functions, scrub_doc
from .feeds import write_feeds
from .normalize import closing_day, tender_status_on
from .sources.buyers import public_spelling

log = logging.getLogger(__name__)

HOME_ROWS = 12
TOP_YEAR_ROWS = 8
RECENT_AWARDS = 500
AWARD_PAGE = 500
OPEN_FIRST_ROWS = 50
NEW_DAYS = 30
# A notice counts as new on the day it is first seen only when it was
# published within this many days before: the first load reads every notice
# since 2022 and sees them all that night, and none of those is news.
NEW_LAG_DAYS = 7
CLOSING_SOON_DAYS = 7
PROFILE_ROWS = 100
# CLAUDE.md's profile contract: the newest 50 lobbying communications.
LOBBYING_ROWS = 50
PROFILE_NAMES = 10
PROFILE_PLACES = 10
PROFILE_BUYERS = 10
BUYER_TOP = 25
BUYER_AWARDS = 50
CATEGORY_TOP = 25
RANK_ROWS = 100
RANK_BUYERS = 50
RUN_ROWS = 20
RELATED_AWARDS = 50
# The radar: rows to a window page, rows on a buyer file or profile, buyers in the index.
EXPIRING_PAGE = 500
EXPIRING_PART_ROWS = 25
EXPIRING_BUYERS = 50
# Yearly files start here; an award date before it (or after the data date)
# is a typing error in the source and gets no page of its own.
FIRST_YEAR = 2000
# The Worker parses at most about 300 KB per request (CLAUDE.md); a profile
# shard above it still works, and the log says which so the caps can move.
PROFILE_SHARD_WARN = 300 * 1024
# The deploy's own limits (nightly.check_export refuses an export past them);
# the export logs them too, so a dev run shows the margin.
MAX_FILES = 19_000
MAX_FILE_BYTES = 25 * 1024 * 1024

MONEY_SOURCES = ("awards", "history", "contracts", "grants")
SOURCES = (*MONEY_SOURCES, "lobbying")
SEGMENTS_PATH = config.PACKAGE_DATA / "unspsc_segments.csv"
ORG_ID_RE = re.compile(r"^org-[0-9a-f]{10}$")
BUYER_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_REF_BAD = re.compile(r"[^A-Za-z0-9._-]+")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")
TEMP_TABLES = ("x_tenders", "x_awards", "x_history", "x_grants", "x_records", "x_proc")

SITEMAP_MAX_URLS = 50_000
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
SITEMAP_PAGES = ["/", "/tenders", "/tenders/new", "/awards", "/expiring", "/organizations", "/buyers", "/segments",
                 "/rankings", "/feeds", "/watchlist", "/data", "/methodology", "/support", "/cite", "/corrections",
                 "/about", "/terms", "/privacy"]
# Pages whose content follows the nightly data carry its date; the others
# change only with the code, so they carry none rather than a false one.
SITEMAP_DATED_PAGES = {"/", "/tenders", "/tenders/new", "/awards", "/expiring", "/organizations", "/buyers", "/segments",
                       "/rankings", "/feeds", "/data"}


# -- small helpers ------------------------------------------------------------------


def _dump(path: Path, obj: object) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Every free-text field (titles, descriptions, comments) loses the email
    # addresses and telephone numbers publishers write into it (export.scrub);
    # one place, so no file can be written without it.
    scrub_doc(obj)
    # allow_nan=False: Python would write NaN or Infinity, which no browser's
    # JSON parser accepts, and one such value would break a whole file on the
    # site. The export fails instead, and the previous one stays published.
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode("utf-8")
    path.write_bytes(data)
    return len(data)


def url_reference(raw: object) -> str | None:
    """The form of a published reference the site accepts in a URL, or None when nothing is left of it."""
    text = _REF_BAD.sub("-", str(raw or "").replace("$", "")).strip("-")
    return text[:80].rstrip("-") or None


def reference_shard(reference: str) -> str:
    """The detail shard of a reference (in its URL form): the first three hex digits of sha1 of it in lower case."""
    return hashlib.sha1(reference.lower().encode("utf-8")).hexdigest()[:3]


def shard_key(organization_id: str) -> str:
    """The profile shard of an organization: the three hex digits after "org-"."""
    return organization_id[4:7]


def _id_range(key: str) -> tuple[str, str]:
    # Ids are "org-" and ten hex digits, so every id of a shard sorts between these two.
    return f"org-{key}", f"org-{key}g"


def _list(text: object) -> list[str] | None:
    """A JSON list column as a list of strings; None for NULL, an empty list or text that is not a list."""
    if text is None or text == "":
        return None
    try:
        value = json.loads(text) if isinstance(text, str) else text
    except ValueError:
        return None
    if not isinstance(value, list):
        return None
    out = [str(v) for v in value if v is not None and str(v).strip()]
    return out or None


def _codes(text: object) -> list[str]:
    return _list(text) or []


def _joined(text: object, sep: str) -> str | None:
    """A JSON list column (the GSIN codes and their descriptions) as one string, which the site shows."""
    items = _list(text)
    return sep.join(items) if items else None


def _comp(value: object) -> bool | None:
    return None if value is None else bool(value)


def _money(value: object) -> float | None:
    return None if value is None else round(float(value), 2)


def _currency(value: object) -> str | None:
    text = str(value or "").strip().upper()
    return text or None


def _text(value: object) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _day(value: object) -> str | None:
    text = str(value or "")
    return text[:10] if _DATE_RE.match(text) else None


def _year_of(value: object) -> int | None:
    text = str(value or "")
    return int(text[:4]) if _DATE_RE.match(text) else None


def _buyer_id(value: object) -> str | None:
    # The site renders a buyer id as a link and checks it against its own
    # pattern; one that does not match would make it refuse the whole list.
    return value if isinstance(value, str) and BUYER_ID_RE.match(value) and len(value) <= 80 else None


def _sol(value: object) -> str | None:
    text = str(value or "").strip().upper()
    return text or None


def _top(items: Iterable[tuple], n: int, key: Callable) -> list:
    return heapq.nsmallest(n, items, key=key)


def _by_value(item: tuple) -> tuple:
    # (id, n, total): largest total first, a missing total last, then the most records, then the id.
    oid, n, total = item[:3]
    return (total is None, -(total or 0), -n, oid)


def _by_count(item: tuple) -> tuple:
    oid, n, total = item[:3]
    return (-n, total is None, -(total or 0), oid)


def read_segments(path: Path | None = None) -> dict[str, tuple[str, str]]:
    """The 57 UNSPSC segments and their titles, from the committed seed."""
    lines = [line for line in (path or SEGMENTS_PATH).read_text(encoding="utf-8").splitlines()
             if line.strip() and not line.startswith("#")]
    return {r["code"].strip(): (r["desc_en"].strip(), r["desc_fr"].strip()) for r in csv.DictReader(lines)}


# -- the model of one export ----------------------------------------------------------


class RefMap:
    """Each published reference of one table and its URL form.

    Two published references that reduce to the same URL form cannot both be
    served; the first in sort order keeps it and the other is left out (and
    counted), rather than one overwriting the other in a shard.
    """

    def __init__(self, conn: sqlite3.Connection, table: str) -> None:
        self.url: dict[str, str] = {}
        self.dropped = 0
        taken: set[str] = set()
        for (raw,) in conn.execute(f"SELECT DISTINCT reference FROM {table} ORDER BY reference"):
            ref = url_reference(raw)
            if ref is None or ref.lower() in taken:
                self.dropped += 1
                continue
            taken.add(ref.lower())
            self.url[raw] = ref

    def get(self, raw: str) -> str | None:
        return self.url.get(raw)

    def shards(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = defaultdict(list)
        for raw, ref in self.url.items():
            out[reference_shard(ref)].append(raw)
        return out


def drop_temp(conn: sqlite3.Connection) -> None:
    for name in TEMP_TABLES:
        try:
            conn.execute(f"DROP TABLE IF EXISTS temp.{name}")
        except sqlite3.Error:
            pass


def _materialize(conn: sqlite3.Connection, as_of: str) -> None:
    """Temporary tables of the records as the site lists them, built once per export.

    x_tenders: each notice at its newest amendment, with its first and last
    sight over every version, the codes of the newest, and shown_status, its
    status on the data date (normalize.tender_status_on: an open notice whose
    closing day has passed is closed). x_awards and
    x_history: each contract at its newest amendment, attributed like the
    totals (organizations._newest_by_reference) except that a contract whose
    newest version withholds its supplier links to no organization; value is
    the rules' value as shown (cancelled counts zero, any currency, NULL when
    the source published none), v the value a total adds (CAD only, never a
    value flagged for checking: organizations.award_value), nv 1 when the
    source published no value, flag 1 when value_flags lists the contract.
    x_grants: each agreement at its highest amendment. x_records:
    indicators.RECORDS, one row per counted record. x_proc: the
    published-contract groups (department and procurement_id) of more than one
    row, with the largest value reported.
    """
    shown = "CASE WHEN status = 'cancelled' THEN 0 WHEN total_value > 0 THEN total_value ELSE amount END"
    drop_temp(conn)
    register_functions(conn)
    conn.execute(
        "CREATE TEMP TABLE x_tenders AS SELECT t.*, tender_status_on(t.status, t.closing, ?) AS shown_status, "
        "(SELECT MIN(z.first_seen) FROM tenders z WHERE z.reference = t.reference) AS first_sight, "
        "(SELECT group_concat(c.unspsc, ' ') FROM tender_codes c WHERE c.reference = t.reference "
        "AND c.amendment = t.amendment) AS codes "
        "FROM tenders t WHERE t.amendment = (SELECT MAX(y.amendment) FROM tenders y WHERE y.reference = t.reference)",
        (as_of,),
    )
    for table, temp, codes, extra, kind in (
        ("awards", "x_awards", "award_codes", "", "award"),
        ("contract_history", "x_history", "history_codes", "n.client_id, n.client_raw_en, n.client_raw_fr, ", "history"),
    ):
        conn.execute(
            f"CREATE TEMP TABLE {temp} AS WITH newest AS ({organizations._newest_by_reference(table, ('reference',))}) "
            "SELECT n.reference, n.amendment, n.solicitation, "
            "CASE WHEN n.supplier_withheld = 1 THEN NULL ELSE n.org END AS org, n.supplier_withheld, "
            "n.title_en, n.title_fr, n.buyer_id, n.buyer_raw_en, n.buyer_raw_fr, " + extra +
            "n.published, n.awarded, n.currency, n.status, n.competitive, n.instrument_type_en, "
            "n.instrument_type_fr, n.provinces, "
            f"{shown} AS value, {organizations.award_value(kind)} AS v, {organizations.AWARD_NO_VALUE} AS nv, "
            f"{organizations.award_flagged(kind)} AS flag, "
            f"(SELECT MIN(z.first_seen) FROM {table} z WHERE z.reference = n.reference) AS first_sight, "
            f"(SELECT group_concat(c.unspsc, ' ') FROM {codes} c WHERE c.reference = n.reference "
            "AND c.amendment = n.amendment) AS codes "
            "FROM newest n"
        )
        conn.execute(f"CREATE INDEX temp.{temp}_org ON {temp}(org)")
    conn.execute("CREATE INDEX temp.x_awards_buyer ON x_awards(buyer_id)")
    conn.execute(
        "CREATE TEMP TABLE x_grants AS WITH newest AS "
        f"({organizations._newest_by_reference('grants', ('owner_org', 'reference'))}) "
        "SELECT owner_org, reference, amendment, org, buyer_id, agreement_type, program_en, program_fr, title_en, "
        "title_fr, value, start, end FROM newest"
    )
    conn.execute("CREATE INDEX temp.x_grants_org ON x_grants(org)")
    indicators.load_records(conn, "x_records")
    conn.execute("CREATE INDEX temp.x_records_org ON x_records(org)")
    conn.execute(
        "CREATE TEMP TABLE x_proc AS SELECT owner_org, procurement_id, MAX(value) AS top FROM contracts "
        "WHERE procurement_id IS NOT NULL AND procurement_id != '' GROUP BY owner_org, procurement_id "
        "HAVING COUNT(*) > 1"
    )


class Model:
    """What every part of one export reads: the data date, the buyers, the segments, the organizations' names."""

    def __init__(self, conn: sqlite3.Connection, today: date) -> None:
        self.conn = conn
        self.today = today
        self.as_of = today.isoformat()
        self.year = today.year
        self.buyers: dict[str, sqlite3.Row] = {r["id"]: r for r in conn.execute("SELECT * FROM buyers")}
        self.segments = read_segments()
        self.unspsc: dict[str, tuple[str | None, str | None]] = {
            r["code"]: (r["desc_en"], r["desc_fr"]) for r in conn.execute("SELECT code, desc_en, desc_fr FROM unspsc_codes")}
        self.orgs: dict[str, tuple[str, str | None]] = {
            r["id"]: (r["display_name"], r["province"])
            for r in conn.execute("SELECT id, display_name, province FROM organizations")}
        self.refs = {kind: RefMap(conn, table) for kind, table in
                     (("tenders", "tenders"), ("awards", "awards"), ("history", "contract_history"))}
        self.flags = value_checks.flagged(conn)
        self.loaded = sources_loaded(conn)
        self._expiring: list[tuple[dict, float | None]] | None = None
        self._expiring_by: dict[str, dict[str, list[tuple[dict, float | None]]]] = {}
        _materialize(conn, self.as_of)
        # The buyers the export lists (export.LISTED_BUYER): a page, a row in
        # buyers/index.json and the rankings, and a link from a record.
        self.listed: set[str] = {b for b in listed_buyer_ids(conn, self.as_of) if b in self.buyers and _buyer_id(b)}

    def buyer_names(self, buyer_id: str | None, raw_en: object = None, raw_fr: object = None) -> tuple[str | None, str | None]:
        """The buyer's names, else the record's own spelling unless it names or locates a person."""
        b = self.buyers.get(buyer_id) if buyer_id else None
        if b is not None:
            return b["name_en"], b["name_fr"]
        return public_spelling(_text(raw_en)), public_spelling(_text(raw_fr))

    def link(self, buyer_id: str | None) -> str | None:
        """The buyer id a record links to: a listed buyer's, else None (the names stay)."""
        return buyer_id if buyer_id in self.listed else None

    def segments_of(self, codes: object) -> list[str]:
        return sorted({c[:2] for c in str(codes or "").split() if c[:2] in self.segments})

    def org(self, oid: str | None) -> tuple[str | None, str | None]:
        """(id, display name) when the id is a live organization; (None, None) otherwise."""
        if oid and oid in self.orgs and ORG_ID_RE.match(oid):
            return oid, self.orgs[oid][0]
        return None, None

    def org_total(self, oid: str, n: int, total: float | None, n_no_value: int | None = 0) -> dict:
        name, province = self.orgs[oid]
        return {"id": oid, "name": name, "n": n, "total": _money(total), "n_no_value": n_no_value or 0,
                "province": province}

    def expiring(self) -> list[tuple[dict, float | None]]:
        """The radar's rows as the site lists them, soonest end first, each with the value its totals add (CAD only)."""
        if self._expiring is None:
            self._expiring = [item for r in self.conn.execute("SELECT * FROM expiring_contracts ORDER BY end, source_key")
                              if (item := expiring_row(self, r)) is not None]
        return self._expiring

    def expiring_part(self, column: str, key: str) -> dict:
        """What a buyer file or a profile carries of the radar: the count, the total and the first rows by end date."""
        if column not in self._expiring_by:
            groups: dict[str, list[tuple[dict, float | None]]] = defaultdict(list)
            for item in self.expiring():
                if item[0][column]:
                    groups[item[0][column]].append(item)
            self._expiring_by[column] = groups
        items = self._expiring_by[column].get(key, [])
        return {"n": len(items), "total": _total(c for _, c in items), "n_no_value": _no_value(items),
                "rows": [r for r, _ in items[:EXPIRING_PART_ROWS]]}


def _total(values: Iterable[float | None]) -> float | None:
    """The sum of the values that are known, to the cent; None when none is."""
    known = [v for v in values if v is not None]
    return round(sum(known), 2) if known else None


def _no_value(items: Iterable[tuple[dict, float | None]]) -> int:
    """How many radar rows carry no value: the source published none (a flagged value is still a value)."""
    return sum(1 for r, _ in items if r["value"] is None)


# The record tables of each profile source, and the meta keys that say a file of it was read.
LOADED_TABLES = {"awards": "awards", "history": "contract_history", "contracts": "contracts", "grants": "grants",
                 "lobbying": "lobbying_communications"}


def sources_loaded(conn: sqlite3.Connection) -> dict[str, bool]:
    """Whether each profile source has ever been read: its table holds a row, or a file of it was read.

    A source never read (the lobbying registry refused every request so far)
    makes each profile carry "<source>_loaded": false, so the site can say
    "not loaded yet" where a count of 0 would read as none.
    """
    out: dict[str, bool] = {}
    keys = [k for (k,) in conn.execute("SELECT key FROM meta WHERE key LIKE '%:sha256' OR key LIKE '%:read_at'")]
    for source, table in LOADED_TABLES.items():
        read = any(k.startswith(f"{source}:") or (k.startswith("canadabuys:") and _canadabuys_stage(k[11:]) == source)
                   for k in keys)
        out[source] = read or conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() is not None
    return out


# -- rows -------------------------------------------------------------------------------


def tender_row(m: Model, r: sqlite3.Row, *, status: bool = False) -> dict | None:
    ref = m.refs["tenders"].get(r["reference"])
    if ref is None:
        return None
    buyer = _buyer_id(r["buyer_id"])
    en, fr = m.buyer_names(buyer, r["buyer_raw_en"], r["buyer_raw_fr"])
    buyer = m.link(buyer)
    row = {
        "reference": ref, "amendment": r["amendment"], "title_en": r["title_en"], "title_fr": r["title_fr"],
        "buyer_id": buyer, "buyer_en": en, "buyer_fr": fr, "published": r["published"], "closing": r["closing"],
        "category": _codes(r["category"]), "notice_type_en": r["notice_type_en"], "notice_type_fr": r["notice_type_fr"],
        "method_en": r["method_en"], "method_fr": r["method_fr"], "segments": m.segments_of(r["codes"]),
        "provinces": _codes(r["provinces"]), "first_seen": r["first_sight"],
    }
    if ref != r["reference"]:
        row["reference_published"] = r["reference"]
    if status:
        # The status on the data date; the file's own beside it (they differ
        # when an open notice's closing day has passed).
        row["status"] = r["shown_status"] or "unknown"
        row["source_status"] = r["status"] or "unknown"
    return row


def award_row(m: Model, kind: str, r: sqlite3.Row) -> dict | None:
    """An award notice or contract history record as a list row. On a history
    row the buyer is the client department; PSPC is the contracting entity of
    every one of them."""
    ref = m.refs[kind].get(r["reference"])
    if ref is None:
        return None
    if kind == "history" and (r["client_id"] or r["client_raw_en"]):
        buyer = _buyer_id(r["client_id"])
        en, fr = m.buyer_names(buyer, r["client_raw_en"], r["client_raw_fr"])
    else:
        buyer = _buyer_id(r["buyer_id"])
        en, fr = m.buyer_names(buyer, r["buyer_raw_en"], r["buyer_raw_fr"])
    buyer = m.link(buyer)
    oid, name = m.org(r["org"])
    row = {
        "reference": ref, "title_en": r["title_en"], "title_fr": r["title_fr"], "organization_id": oid,
        "organization": name, "buyer_id": buyer, "buyer_en": en, "buyer_fr": fr, "awarded": r["awarded"],
        "value": _money(r["value"]), "currency": _currency(r["currency"]), "competitive": _comp(r["competitive"]),
        "instrument_en": r["instrument_type_en"], "instrument_fr": r["instrument_type_fr"],
        "segments": m.segments_of(r["codes"]), "provinces": _codes(r["provinces"]), "status": r["status"] or "unknown",
    }
    if ref != r["reference"]:
        row["reference_published"] = r["reference"]
    if r["supplier_withheld"]:
        row["supplier_withheld"] = True
    _value_flag(row, r["flag"])
    return row


def _value_flag(row: dict, flagged: object) -> None:
    """value_flag "check" on a row whose value value_checks.py flagged (the site shows a note; no total adds it)."""
    if flagged:
        row["value_flag"] = "check"


def contract_row(m: Model, r: sqlite3.Row) -> dict:
    """A published contract: its own value by the counting rules, and the
    largest value reported for its procurement_id beside it when the group
    has several rows (shown, never added). buyer_name is never read: it
    holds public servants' names."""
    if r["instrument_type"] == "A" or (r["amendment_value"] is not None and r["amendment_value"] != 0):
        own = r["amendment_value"]
    elif r["original_value"] is not None:
        own = r["original_value"]
    else:
        own = r["value"]
    buyer = _buyer_id(r["buyer_id"])
    en, fr = m.buyer_names(buyer)
    buyer = m.link(buyer)
    row = {
        "owner_org": r["owner_org"], "reference": r["reference"], "procurement_id": _text(r["procurement_id"]),
        "buyer_id": buyer, "buyer_en": en, "buyer_fr": fr, "contract_date": r["contract_date"], "value": _money(own),
        "description_en": r["description_en"], "description_fr": r["description_fr"],
        "competitive": _comp(r["competitive"]), "solicitation_procedure": r["solicitation_procedure"],
        "instrument_type": r["instrument_type"], "reporting_period": r["reporting_period"],
    }
    if r["top"] is not None:
        row["value_last_reported"] = _money(r["top"])
    _value_flag(row, f"{r['owner_org']}:{r['procurement_id']}" in m.flags["contract"])
    return row


def grant_row(m: Model, r: sqlite3.Row) -> dict:
    buyer = _buyer_id(r["buyer_id"])
    en, fr = m.buyer_names(buyer)
    buyer = m.link(buyer)
    return {
        "owner_org": r["owner_org"], "reference": r["reference"], "amendment": r["amendment"], "buyer_id": buyer,
        "buyer_en": en, "buyer_fr": fr, "agreement_type": r["agreement_type"], "program_en": r["program_en"],
        "program_fr": r["program_fr"], "title_en": r["title_en"], "title_fr": r["title_fr"],
        "value": _money(r["value"]), "start": r["start"], "end": r["end"],
    }


def _dpoh(text: object) -> list[dict]:
    try:
        items = json.loads(text) if isinstance(text, str) and text else []
    except ValueError:
        return []
    out = []
    for d in items if isinstance(items, list) else []:
        if isinstance(d, dict) and _text(d.get("name")):
            out.append({"name": _text(d.get("name")), "title": _text(d.get("title")),
                        "institution": _text(d.get("institution"))})
    return out


def lobbying_row(r: sqlite3.Row) -> dict:
    """A communication report. The registrant is a registered lobbyist and the
    office holders are designated public office holders, each named in the
    public role the registry publishes."""
    return {
        "comm_number": r["comm_number"], "comm_date": r["comm_date"], "registrant": r["registrant_raw"],
        "subject_matters": _codes(r["subject_matters"]), "institutions": _codes(r["institutions"]),
        "dpoh": _dpoh(r["dpoh"]),
    }


def expiring_row(m: Model, r: sqlite3.Row) -> tuple[dict, float | None] | None:
    """A row of the radar (expiring_contracts) as the site lists it, and the value its totals add.

    days_left is counted again from the export's data date, and a row that has
    ended since the radar was built, or that ends beyond the horizon, is left
    out. An award or history reference takes its URL form like every other
    file (reference_published beside it when they differ); a published
    contract's "owner_org:reference" only goes into a search query on the site.
    A withheld supplier stays withheld: no organization, supplier_withheld true.
    """
    end = _day(r["end"])
    if end is None:
        return None
    days_left = (date.fromisoformat(end) - m.today).days
    if not 0 <= days_left <= expiring.HORIZON_DAYS:
        return None
    kind = r["kind"]
    if kind in ("award", "history"):
        ref = m.refs["awards" if kind == "award" else "history"].get(r["reference"])
        if ref is None:
            return None
    else:
        ref = str(r["reference"])[:200]
    withheld = bool(r["supplier_withheld"])
    oid, name = (None, None) if withheld else m.org(r["organization_id"])
    buyer = _buyer_id(r["buyer_id"])
    en, fr = m.buyer_names(buyer, r["buyer_en"], r["buyer_fr"])
    buyer = m.link(buyer)
    row = {
        "kind": kind, "reference": ref, "title_en": r["title_en"], "title_fr": r["title_fr"], "organization_id": oid,
        "organization": name, "buyer_id": buyer, "buyer_en": en, "buyer_fr": fr, "start": r["start"], "end": end,
        "days_left": days_left, "value": _money(r["value"]), "currency": _currency(r["currency"]),
        "competitive": _comp(r["competitive"]), "method_en": r["method_en"], "method_fr": r["method_fr"],
        "instrument_en": r["instrument_en"], "instrument_fr": r["instrument_fr"], "n_amendments": r["n_amendments"] or 0,
        "value_growth": None if r["value_growth"] is None else round(float(r["value_growth"]), 4),
        "tender_reference": m.refs["tenders"].get(r["tender_reference"]) if r["tender_reference"] else None,
        "segments": [s for s in _codes(r["segments"]) if s in m.segments], "provinces": _codes(r["provinces"]),
    }
    if withheld:
        row["supplier_withheld"] = True
    if kind != "contract" and ref != r["reference"]:
        row["reference_published"] = r["reference"]
    _expiring_extra(row, r)
    counted = row["value"] if row["currency"] in (None, "CAD") and "value_flag" not in row else None
    return row, counted


def _expiring_extra(row: dict, r: sqlite3.Row) -> None:
    """The client department a reader filters by (expiring.py names it) and the value flag."""
    client = _buyer_id(r["client_buyer_id"])
    row.update(client_buyer_id=client, client_buyer_name=_text(r["client_buyer_name"]),
               client_buyer_name_fr=_text(r["client_buyer_name_fr"]))
    _value_flag(row, r["value_flag"])


# -- stats.json -----------------------------------------------------------------------


SOURCE_FILES = {
    "contracts": config.CONTRACTS_URL.rsplit("/", 1)[-1],
    "grants": config.GRANTS_URL.rsplit("/", 1)[-1],
    "lobbying": config.LOBBYING_URL.rsplit("/", 1)[-1],
}
# The stages that read a source, in the order the Data page lists them; each
# key is the "source" of its rows in stats.json "sources".
SOURCE_ORDER = ("buyers", "tenders", "awards", "history", "contracts", "grants", "lobbying", "registry")
# The file a source's row names until a read records its own (a source never read yet).
SOURCE_DEFAULT_FILE = {
    "buyers": "organization_show",
    "tenders": config.TENDERS_COMPLETE_FILE,
    "awards": config.AWARDS_COMPLETE_FILE,
    "history": config.HISTORY_COMPLETE_FILE,
    **SOURCE_FILES,
    "registry": "corporations-active-cbca-en.csv",
}
# The buyers stage records the time it read the CKAN organization list under
# this key (sources/buyers.py); a database from before it has only the
# refresh schedule's key, which is set by a read too.
BUYERS_READ_KEYS = ("buyers:read_at", "buyers_loaded_at")


def _canadabuys_stage(name: str) -> str | None:
    low = name.lower()
    if "tendernotice" in low:
        return "tenders"
    if "awardnotice" in low:
        return "awards"
    if "contracthistory" in low:
        return "history"
    return None


def http_date_iso(value: object) -> str | None:
    """A Last-Modified header ("Sun, 01 Nov 2026 17:15:06 GMT") as an ISO instant in UTC
    ("2026-11-01T17:15:06Z"); None for a blank or a value that is not an HTTP date."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        when = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def source_files(conn: sqlite3.Connection) -> list[dict]:
    """The files the stages read, by stage: when each was last read and the Last-Modified the publisher gave.

    One row per file read (meta "canadabuys:<file>:", "<stage>:" for the
    proactive publications and the lobbying registry, "registry:<file>:" for
    the corporations extract, "buyers:read_at" for the CKAN organization
    list), and one row for every source with none, so each source the Data
    page lists has a row. last_read is when the file was last read (ISO, UTC);
    last_modified the publisher's Last-Modified as an ISO instant in UTC
    (null when it gave none), with the header as sent in last_modified_http;
    loaded is false until the first successful read.
    """
    seen: dict[tuple[str, str], dict] = {}

    def entry(stage: str, file: str) -> dict:
        return seen.setdefault((stage, file), {"source": stage, "file": file, "last_read": None,
                                               "last_modified": None, "last_modified_http": None, "loaded": False})

    for key, value in conn.execute("SELECT key, value FROM meta ORDER BY key"):
        m = re.fullmatch(r"(canadabuys|registry):(.+):(read_at|last_modified)", key)
        if m:
            stage = _canadabuys_stage(m.group(2)) if m.group(1) == "canadabuys" else "registry"
            file, item = m.group(2), m.group(3)
        else:
            m = re.fullmatch(r"(contracts|grants|lobbying):(read_at|last_modified)", key)
            if not m:
                continue
            stage, file, item = m.group(1), SOURCE_FILES[m.group(1)], m.group(2)
        if stage is None:
            continue
        row = entry(stage, file)
        if item == "read_at":
            row["last_read"] = value
        else:
            row["last_modified_http"] = value
            row["last_modified"] = http_date_iso(value)
    buyers_read = next((v for k in BUYERS_READ_KEYS if (v := get_meta(conn, k))), None)
    if buyers_read:
        entry("buyers", SOURCE_DEFAULT_FILE["buyers"])["last_read"] = buyers_read
    for row in seen.values():
        row["loaded"] = row["last_read"] is not None
    for stage in SOURCE_ORDER:
        if not any(source == stage for source, _ in seen):
            entry(stage, SOURCE_DEFAULT_FILE[stage])
    return sorted(seen.values(), key=lambda e: (SOURCE_ORDER.index(e["source"]), e["file"]))


def closing_soon(m: Model, open_rows: list[dict]) -> list[dict]:
    """The open notices whose closing day (normalize.closing_day, in UTC) falls within CLOSING_SOON_DAYS of
    the data date, soonest first."""
    soon_end = (m.today + timedelta(days=CLOSING_SOON_DAYS)).isoformat()
    return [r for r in open_rows if (day := closing_day(r["closing"])) and m.as_of <= day <= soon_end]


def write_stats(m: Model, out: Path, *, counts: dict[str, int], open_rows: list[dict], new_today: list[dict],
                top_year: list[dict]) -> dict:
    conn = m.conn
    recent = [row for r in conn.execute(
        "SELECT * FROM x_awards ORDER BY published DESC, awarded DESC, reference LIMIT ?", (HOME_ROWS * 2,))
        if (row := award_row(m, "awards", r))][:HOME_ROWS]
    runs = [{"run_at": r["run_at"], "source": r["source"], "detail": (r["detail"] or "")[:300] or None,
             "rows_new": r["rows_new"], "ok": r["ok"]}
            for r in conn.execute("SELECT run_at, source, detail, rows_new, ok FROM sources_log ORDER BY id DESC LIMIT ?",
                                  (RUN_ROWS,))]
    stats = {
        "data_as_of": m.as_of,
        "counts": counts,
        "new_tenders": sorted(new_today, key=lambda r: (r["published"] or "", r["reference"]), reverse=True)[:HOME_ROWS],
        "closing_soon": closing_soon(m, open_rows)[:HOME_ROWS],
        "recent_awards": recent,
        "top_organizations_year": top_year,
        "runs": runs,
        "sources": source_files(conn),
    }
    _dump(out / "stats.json", stats)
    return stats


# -- tenders ------------------------------------------------------------------------


FACETS = ("category", "segment", "province", "buyer", "notice_type", "method")


def tender_facets(rows: list[dict]) -> dict[str, list[dict]]:
    """Counts over every open notice for the filter bar: a code for category,
    segment and province; a buyer id with its names; the English text of a
    notice type or method with both labels. Most notices first."""
    counts: dict[str, Counter] = {f: Counter() for f in FACETS}
    labels: dict[str, dict[str, tuple[str | None, str | None]]] = {f: {} for f in FACETS}
    for r in rows:
        counts["category"].update(set(r["category"]))
        counts["segment"].update(set(r["segments"]))
        counts["province"].update(set(r["provinces"]))
        if r["buyer_id"]:
            counts["buyer"][r["buyer_id"]] += 1
            labels["buyer"].setdefault(r["buyer_id"], (r["buyer_en"], r["buyer_fr"]))
        for facet, en, fr in (("notice_type", r["notice_type_en"], r["notice_type_fr"]),
                              ("method", r["method_en"], r["method_fr"])):
            if en:
                counts[facet][en] += 1
                labels[facet].setdefault(en, (en, fr))
    out: dict[str, list[dict]] = {}
    for facet in FACETS:
        items = []
        for value, n in sorted(counts[facet].items(), key=lambda kv: (-kv[1], kv[0])):
            item: dict = {"value": value, "n": n}
            if value in labels[facet]:
                item["en"], item["fr"] = labels[facet][value]
            items.append(item)
        out[facet] = items
    return out


def write_tender_lists(m: Model, out: Path) -> tuple[list[dict], list[dict], dict[str, int]]:
    """tenders/open.json, tenders/open-first.json and tenders/new/<day>.json.

    Returns the open rows (soonest closing first), today's new rows, and counts.
    A day of the last 30 with no new notice gets an empty list, so the page
    says none rather than "not published".
    """
    conn = m.conn
    open_rows = [row for r in conn.execute(
        "SELECT * FROM x_tenders WHERE shown_status = 'open' ORDER BY closing IS NULL, closing, reference")
        if (row := tender_row(m, r))]
    _dump(out / "tenders" / "open.json", open_rows)
    _dump(out / "tenders" / "open-first.json", {
        "total": len(open_rows), "rows": open_rows[:OPEN_FIRST_ROWS], "facets": tender_facets(open_rows)})
    first_day = (m.today - timedelta(days=NEW_DAYS - 1)).isoformat()
    by_day: dict[str, list[dict]] = {(m.today - timedelta(days=i)).isoformat(): [] for i in range(NEW_DAYS)}
    for r in conn.execute("SELECT * FROM x_tenders WHERE first_sight >= ? ORDER BY published DESC, reference",
                          (first_day,)):
        day = _day(r["first_sight"])
        if day not in by_day:
            continue
        published = _day(r["published"])
        if published and published < (date.fromisoformat(day) - timedelta(days=NEW_LAG_DAYS)).isoformat():
            continue
        if row := tender_row(m, r, status=True):
            by_day[day].append(row)
    for day, rows in by_day.items():
        _dump(out / "tenders" / "new" / f"{day}.json", rows)
    return open_rows, by_day[m.as_of], {"tenders_open": len(open_rows), "tenders_new_days": len(by_day)}


def _code_rows(m: Model, codes: Iterable[str]) -> list[dict]:
    out = []
    for code in sorted(set(codes)):
        en, fr = m.unspsc.get(code, (None, None))
        if len(code) == 2 and code in m.segments:
            en, fr = en or m.segments[code][0], fr or m.segments[code][1]
        out.append({"code": code, "desc_en": en, "desc_fr": fr})
    return out


def _in_chunks(conn: sqlite3.Connection, sql: str, keys: Sequence[str], size: int = 500) -> Iterable[sqlite3.Row]:
    for i in range(0, len(keys), size):
        chunk = list(keys[i:i + size])
        yield from conn.execute(sql.format(marks=",".join("?" * len(chunk))), chunk)


def _codes_by_version(conn: sqlite3.Connection, table: str, refs: Sequence[str]) -> dict[tuple[str, int], list[str]]:
    out: dict[tuple[str, int], list[str]] = defaultdict(list)
    for r in _in_chunks(conn, f"SELECT reference, amendment, unspsc FROM {table} WHERE reference IN ({{marks}})", refs):
        out[(r["reference"], r["amendment"])].append(r["unspsc"])
    return out


def _versions(conn: sqlite3.Connection, table: str, refs: Sequence[str]) -> dict[str, list[sqlite3.Row]]:
    out: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for r in _in_chunks(conn, f"SELECT * FROM {table} WHERE reference IN ({{marks}}) ORDER BY reference, amendment", refs):
        out[r["reference"]].append(r)
    return out


def related_awards(m: Model, solicitations: set[str]) -> dict[str, list[dict]]:
    """The award notices of each solicitation number a tender carries, newest award first."""
    out: dict[str, list[dict]] = defaultdict(list)
    for r in m.conn.execute("SELECT * FROM x_awards WHERE solicitation IS NOT NULL ORDER BY awarded DESC, reference"):
        sol = _sol(r["solicitation"])
        ref = m.refs["awards"].get(r["reference"])
        if sol not in solicitations or ref is None or len(out[sol]) >= RELATED_AWARDS:
            continue
        oid, name = m.org(r["org"])
        item = {"reference": ref, "title_en": r["title_en"], "title_fr": r["title_fr"], "organization_id": oid,
                "organization": name, "awarded": r["awarded"], "value": _money(r["value"]),
                "currency": _currency(r["currency"])}
        if r["supplier_withheld"]:
            item["supplier_withheld"] = True
        out[sol].append(item)
    return out


_TENDER_TEXT = ("solicitation", "title_en", "title_fr", "published", "closing", "amended", "start_expected",
                "end_expected", "notice_type_en", "notice_type_fr", "method_en", "method_fr", "selection_en",
                "selection_fr", "limited_reason_en", "limited_reason_fr", "description_en", "description_fr",
                "source_file")
_TENDER_LISTS = ("trade_agreements_en", "trade_agreements_fr", "regions_opportunity_en", "regions_opportunity_fr",
                 "regions_delivery_en", "regions_delivery_fr", "end_users_en", "end_users_fr")


def tender_detail(m: Model, ref: str, versions: list[sqlite3.Row], codes: list[str],
                  related: dict[str, list[dict]]) -> dict:
    """A notice as it stands (its newest amendment) with its versions. The contact columns are never read.

    status is the notice's status on the data date and source_status the one
    its file states; each version in amendments keeps the status stored for it.
    """
    v = versions[-1]
    buyer = _buyer_id(v["buyer_id"])
    en, fr = m.buyer_names(buyer, v["buyer_raw_en"], v["buyer_raw_fr"])
    buyer = m.link(buyer)
    d: dict = {k: v[k] for k in _TENDER_TEXT}
    d.update({k: _list(v[k]) for k in _TENDER_LISTS})
    d.update({
        "reference": ref, "amendment": v["amendment"],
        "status": tender_status_on(v["status"], v["closing"], m.as_of), "source_status": v["status"] or "unknown",
        "gsin": _joined(v["gsin"], ", "), "gsin_desc_en": _joined(v["gsin_desc_en"], "; "),
        "gsin_desc_fr": _joined(v["gsin_desc_fr"], "; "), "category": _codes(v["category"]),
        "provinces": _codes(v["provinces"]), "buyer_id": buyer, "buyer_en": en, "buyer_fr": fr,
        "first_seen": min(x["first_seen"] for x in versions), "last_seen": max(x["last_seen"] for x in versions),
        "codes": _code_rows(m, codes),
        "amendments": [{"amendment": x["amendment"], "published": x["published"], "amended": x["amended"],
                        "closing": x["closing"], "status": x["status"], "title_en": x["title_en"],
                        "title_fr": x["title_fr"], "first_seen": x["first_seen"]} for x in versions],
        "related_awards": related.get(_sol(v["solicitation"]) or "", []),
    })
    if ref != v["reference"]:
        d["reference_published"] = v["reference"]
    return d


def write_tender_shards(m: Model, out: Path) -> dict[str, int]:
    conn = m.conn
    solicitations = {s for (raw,) in conn.execute("SELECT DISTINCT solicitation FROM tenders") if (s := _sol(raw))}
    related = related_awards(m, solicitations)
    shards = m.refs["tenders"].shards()
    written = largest = 0
    for key in sorted(shards):
        refs = sorted(shards[key])
        versions = _versions(conn, "tenders", refs)
        codes = _codes_by_version(conn, "tender_codes", refs)
        shard = {}
        for raw in refs:
            rows = versions[raw]
            if rows:
                ref = m.refs["tenders"].url[raw]
                shard[ref.lower()] = tender_detail(m, ref, rows, codes.get((raw, rows[-1]["amendment"]), []), related)
        largest = max(largest, _dump(out / "tenders" / f"{key}.json", shard))
        written += 1
    return {"tender_shards": written, "tender_shard_max_bytes": largest,
            "tender_refs_left_out": m.refs["tenders"].dropped}


# -- award notices and contract history -------------------------------------------------


_CONTRACT_TEXT = ("solicitation", "contract_number", "title_en", "title_fr", "published", "awarded", "amended",
                  "start", "end", "instrument_type_en", "instrument_type_fr", "amendment_type_en",
                  "amendment_type_fr", "notice_type_en", "notice_type_fr", "method_en", "method_fr", "selection_en",
                  "selection_fr", "limited_reason_en", "limited_reason_fr", "supplier_province", "supplier_country",
                  "description_en", "description_fr", "source_file")
_CONTRACT_LISTS = ("trade_agreements_en", "trade_agreements_fr", "regions_delivery_en", "regions_delivery_fr")


def contract_detail(m: Model, kind: str, ref: str, versions: list[sqlite3.Row], codes: list[str],
                    tenders: dict[str, str]) -> dict:
    """An award notice or a contract history record at its newest amendment, with its versions.

    A supplier withheld on the newest version is exported as supplier null and
    supplier_withheld true, with no organization, city or operating name
    whatever the row holds; the contacts and the street are never read.
    """
    v = versions[-1]
    withheld = bool(v["supplier_withheld"])
    org = None
    if not withheld:
        org = next((x["organization_id"] for x in reversed(versions) if x["organization_id"]), None)
    oid, _ = m.org(org)
    buyer = _buyer_id(v["buyer_id"])
    en, fr = m.buyer_names(buyer, v["buyer_raw_en"], v["buyer_raw_fr"])
    buyer = m.link(buyer)
    if v["status"] == "cancelled":
        value = 0.0
    elif v["total_value"] is not None and v["total_value"] > 0:
        value = v["total_value"]
    else:
        value = v["amount"]
    d: dict = {k: v[k] for k in _CONTRACT_TEXT}
    d.update({k: _list(v[k]) for k in _CONTRACT_LISTS})
    d.update({
        "kind": "award" if kind == "awards" else "history", "reference": ref, "amendment": v["amendment"],
        "amount": _money(v["amount"]), "total_value": _money(v["total_value"]), "value": _money(value),
        "currency": _currency(v["currency"]), "status": v["status"] or "unknown",
        "gsin": _joined(v["gsin"], ", "), "gsin_desc_en": _joined(v["gsin_desc_en"], "; "),
        "gsin_desc_fr": _joined(v["gsin_desc_fr"], "; "), "category": _codes(v["category"]),
        "competitive": _comp(v["competitive"]), "provinces": _codes(v["provinces"]), "organization_id": oid,
        "supplier": None if withheld else v["supplier_raw"], "supplier_city": None if withheld else v["supplier_city"],
        "buyer_id": buyer, "buyer_en": en, "buyer_fr": fr,
        "first_seen": min(x["first_seen"] for x in versions), "last_seen": max(x["last_seen"] for x in versions),
        "codes": _code_rows(m, codes),
        "amendments": [{"amendment": x["amendment"], "amended": x["amended"], "amount": _money(x["amount"]),
                        "total_value": _money(x["total_value"]), "status": x["status"],
                        "amendment_type_en": x["amendment_type_en"], "amendment_type_fr": x["amendment_type_fr"]}
                       for x in versions],
        "tender_reference": tenders.get(_sol(v["solicitation"]) or ""),
    })
    if withheld:
        d["supplier_withheld"] = True
    _value_flag(d, v["reference"] in m.flags["award" if kind == "awards" else "history"])
    if kind == "awards":
        d["end_users_en"], d["end_users_fr"] = _list(v["end_users_en"]), _list(v["end_users_fr"])
    else:
        client = _buyer_id(v["client_id"])
        c_en, c_fr = m.buyer_names(client, v["client_raw_en"], v["client_raw_fr"])
        client = m.link(client)
        d.update({"procurement_number": v["procurement_number"], "client_id": client, "client_en": c_en,
                  "client_fr": c_fr, "supplier_operating": None if withheld else v["supplier_operating"]})
    if ref != v["reference"]:
        d["reference_published"] = v["reference"]
    return d


def write_contract_shards(m: Model, out: Path) -> dict[str, int]:
    conn = m.conn
    tenders: dict[str, str] = {}
    for r in conn.execute("SELECT reference, solicitation FROM x_tenders ORDER BY reference"):
        sol, ref = _sol(r["solicitation"]), m.refs["tenders"].get(r["reference"])
        if sol and ref and sol not in tenders:
            tenders[sol] = ref
    parts = {kind: m.refs[kind].shards() for kind in ("awards", "history")}
    tables = {"awards": ("awards", "award_codes", "award"), "history": ("contract_history", "history_codes", "history")}
    written = largest = 0
    for key in sorted(set(parts["awards"]) | set(parts["history"])):
        shard = {}
        for kind in ("awards", "history"):
            refs = sorted(parts[kind].get(key, []))
            if not refs:
                continue
            table, code_table, prefix = tables[kind]
            versions = _versions(conn, table, refs)
            codes = _codes_by_version(conn, code_table, refs)
            for raw in refs:
                rows = versions[raw]
                if rows:
                    ref = m.refs[kind].url[raw]
                    shard[f"{prefix}:{ref.lower()}"] = contract_detail(
                        m, kind, ref, rows, codes.get((raw, rows[-1]["amendment"]), []), tenders)
        largest = max(largest, _dump(out / "contracts" / f"{key}.json", shard))
        written += 1
    return {"contract_shards": written, "contract_shard_max_bytes": largest,
            "award_refs_left_out": m.refs["awards"].dropped, "history_refs_left_out": m.refs["history"].dropped}


def write_award_lists(m: Model, out: Path) -> dict[str, int]:
    """awards/recent.json and each year's pages, by the calendar year of the award date."""
    conn = m.conn
    recent = [row for r in conn.execute(
        "SELECT * FROM x_awards ORDER BY published DESC, awarded DESC, reference LIMIT ?", (RECENT_AWARDS * 2,))
        if (row := award_row(m, "awards", r))][:RECENT_AWARDS]
    _dump(out / "awards" / "recent.json", recent)
    years: dict[int, list[dict]] = defaultdict(list)
    for r in conn.execute("SELECT * FROM x_awards WHERE awarded IS NOT NULL ORDER BY awarded DESC, reference"):
        year = _year_of(r["awarded"])
        if year is None or not FIRST_YEAR <= year <= m.year:
            continue
        if row := award_row(m, "awards", r):
            years[year].append(row)
    pages_written = 0
    for year, rows in years.items():
        pages = [rows[i:i + AWARD_PAGE] for i in range(0, len(rows), AWARD_PAGE)]
        for n, page in enumerate(pages, start=1):
            _dump(out / "awards" / str(year) / f"{n}.json", page)
        _dump(out / "awards" / str(year) / "index.json", {"year": year, "pages": len(pages), "rows": len(rows)})
        pages_written += len(pages)
    return {"award_years": len(years), "award_pages": pages_written}


# -- profiles -----------------------------------------------------------------------


ORG_FIELDS = ("id", "display_name", "country", "province", "city", "business_number", "first_seen", "last_seen",
              "n_awards", "n_history", "n_contracts", "n_grants", "n_lobbying", "total_awards", "total_history",
              "total_contracts", "total_grants", *organizations.NO_VALUE_FIELDS)


def _grouped(rows: Iterable[sqlite3.Row], column: str) -> dict[str, list[sqlite3.Row]]:
    out: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for r in rows:
        out[r[column]].append(r)
    return out


def _profile_tables(conn: sqlite3.Connection, rng: tuple[str, str]) -> dict[str, dict[str, list[sqlite3.Row]]]:
    """Every row a shard's profiles show, read with one query per table over the shard's id range."""
    queries = {
        "names": ("SELECT organization_id, raw_name, source, n FROM organization_names WHERE organization_id >= ? "
                  "AND organization_id < ? ORDER BY organization_id, n DESC, raw_name, source", "organization_id"),
        "places": ("SELECT organization_id, country, province, city, SUM(n) AS n FROM organization_places "
                   "WHERE organization_id >= ? AND organization_id < ? GROUP BY organization_id, country, province, "
                   "city ORDER BY organization_id, n DESC, country, province, city", "organization_id"),
        "registry": ("SELECT * FROM registry_matches WHERE organization_id >= ? AND organization_id < ? "
                     "ORDER BY organization_id, registry, registry_id", "organization_id"),
        "years": ("SELECT * FROM organization_years WHERE organization_id >= ? AND organization_id < ? "
                  "ORDER BY organization_id, year DESC, source", "organization_id"),
        "awards": ("SELECT * FROM x_awards WHERE org >= ? AND org < ? "
                   "ORDER BY org, awarded DESC, published DESC, reference", "org"),
        "history": ("SELECT * FROM x_history WHERE org >= ? AND org < ? "
                    "ORDER BY org, awarded DESC, published DESC, reference", "org"),
        "contracts": ("SELECT c.*, p.top FROM contracts c LEFT JOIN x_proc p ON p.owner_org = c.owner_org "
                      "AND p.procurement_id = c.procurement_id WHERE c.organization_id >= ? AND c.organization_id < ? "
                      "ORDER BY c.organization_id, c.contract_date DESC, c.owner_org, c.reference", "organization_id"),
        "grants": ("SELECT * FROM x_grants WHERE org >= ? AND org < ? ORDER BY org, start DESC, owner_org, reference",
                   "org"),
        "lobbying": ("SELECT * FROM lobbying_communications WHERE organization_id >= ? AND organization_id < ? "
                     "ORDER BY organization_id, comm_date DESC, comm_number", "organization_id"),
        "buyers": ("SELECT org, source, buyer, COUNT(*) AS n, SUM(v) AS total, SUM(nv) AS nv FROM x_records "
                   "WHERE org >= ? AND org < ? AND buyer IS NOT NULL GROUP BY org, source, buyer", "org"),
    }
    return {name: _grouped(conn.execute(sql, rng), column) for name, (sql, column) in queries.items()}


def profile(m: Model, o: sqlite3.Row, t: dict[str, dict[str, list[sqlite3.Row]]], non_cad: dict[str, int]) -> dict:
    oid = o["id"]
    place_rows = t["places"].get(oid, [])
    p: dict = {
        "organization": {k: o[k] for k in ORG_FIELDS},
        "names": [{"name": r["raw_name"], "source": r["source"], "n": r["n"]} for r in t["names"].get(oid, [])[:PROFILE_NAMES]],
        "places": [{"country": r["country"] or None, "province": r["province"] or None, "city": r["city"] or None,
                    "n": r["n"]} for r in place_rows[:PROFILE_PLACES]],
        "registry": [{k: r[k] for k in ("registry", "registry_id", "legal_name", "entity_type", "status",
                                        "registered_on", "grade", "checked_at")} for r in t["registry"].get(oid, [])],
        "years": [{"year": r["year"], "source": r["source"], "n": r["n"], "total": _money(r["total"]),
                   "n_non_competitive": r["n_non_competitive"], "total_non_competitive": _money(r["total_non_competitive"]),
                   "n_no_value": r["n_no_value"] or 0}
                  for r in t["years"].get(oid, [])],
    }
    for k in ("total_awards", "total_history", "total_contracts", "total_grants"):
        p["organization"][k] = _money(p["organization"][k])
    if len(place_rows) > PROFILE_PLACES:
        p["places_total_rows"] = len(place_rows)
    builders: tuple[tuple[str, Callable[[sqlite3.Row], dict | None], int], ...] = (
        ("awards", lambda r: award_row(m, "awards", r), PROFILE_ROWS),
        ("history", lambda r: award_row(m, "history", r), PROFILE_ROWS),
        ("contracts", lambda r: contract_row(m, r), PROFILE_ROWS),
        ("grants", lambda r: grant_row(m, r), PROFILE_ROWS),
        ("lobbying", lobbying_row, LOBBYING_ROWS),
    )
    for source, build, cap in builders:
        mine = t[source].get(oid, [])
        p[source] = [row for r in mine[:cap] if (row := build(r)) is not None]
        p[f"{source}_total_rows"] = len(mine)
    top: list[dict] = []
    by_source = _grouped(t["buyers"].get(oid, []), "source")
    for source in MONEY_SOURCES:
        cells = ((r["buyer"], r["n"], r["total"], r["nv"]) for r in by_source.get(source, []) if m.link(r["buyer"]))
        for bid, n, total, nv in _top(cells, PROFILE_BUYERS, _by_value):
            en, fr = m.buyer_names(bid)
            top.append({"source": source, "buyer_id": bid, "buyer_en": en, "buyer_fr": fr, "n": n, "total": _money(total),
                        "n_no_value": nv or 0})
    p["buyers"] = top
    p["expiring"] = m.expiring_part("organization_id", oid)
    if non_cad:
        p["non_cad"] = dict(sorted(non_cad.items()))
    return p


def _value_checks(conn: sqlite3.Connection, rng: tuple[str, str]) -> dict[str, dict[str, int]]:
    """Per organization of a shard, the records of each source whose value is flagged for checking."""
    out: dict[str, dict[str, int]] = defaultdict(dict)
    for oid, source, n in conn.execute("SELECT org, source, COUNT(*) FROM x_records WHERE org >= ? AND org < ? "
                                       "AND chk = 1 GROUP BY org, source", rng):
        out[oid][source] = n
    return out


def _profile_extra(m: Model, p: dict, checks: dict[str, int]) -> dict:
    """What a profile carries beside its lists: value_check, the records of each source whose value is flagged
    for checking and left out of the totals (like non_cad); and "<source>_loaded": false for a source never
    read, whose count of 0 means not loaded rather than none."""
    if checks:
        p["value_check"] = dict(sorted(checks.items()))
    for source in SOURCES:
        if not m.loaded.get(source, True):
            p[f"{source}_loaded"] = False
    return p


def write_profiles(conn: sqlite3.Connection, out: Path, m: Model) -> dict[str, int]:
    """profiles/<abc>.json: every organization's profile, one shard per three hex digits of its id."""
    keys = sorted({shard_key(oid) for oid in m.orgs})
    written = largest_bytes = 0
    over: list[str] = []
    for key in keys:
        rng = _id_range(key)
        orgs = conn.execute(f"SELECT {', '.join(ORG_FIELDS)} FROM organizations WHERE id >= ? AND id < ? ORDER BY id",
                            rng).fetchall()
        tables = _profile_tables(conn, rng)
        non_cad: dict[str, dict[str, int]] = defaultdict(dict)
        for source, temp in (("awards", "x_awards"), ("history", "x_history")):
            for oid, n in conn.execute(
                    f"SELECT org, COUNT(*) FROM {temp} WHERE org >= ? AND org < ? "
                    "AND UPPER(TRIM(COALESCE(currency, ''))) NOT IN ('', 'CAD') GROUP BY org", rng):
                non_cad[oid][source] = n
        checks = _value_checks(conn, rng)
        shard = {o["id"]: _profile_extra(m, profile(m, o, tables, non_cad.get(o["id"], {})), checks.get(o["id"], {}))
                 for o in orgs}
        size = _dump(out / "profiles" / f"{key}.json", shard)
        written += 1
        largest_bytes = max(largest_bytes, size)
        if size > PROFILE_SHARD_WARN:
            over.append(f"profiles/{key}.json ({size // 1024} KB)")
    if over:
        log.warning("export: %d profile shards above %d KB: %s", len(over), PROFILE_SHARD_WARN // 1024,
                    ", ".join(over[:20]))
    return {"profile_shards": written, "profile_shard_max_bytes": largest_bytes, "profile_shards_over_300kb": len(over)}


def resolve_aliases(conn: sqlite3.Connection) -> dict[str, str]:
    """Each retired organization id mapped to the live id its records ended up under.

    An alias may point at an id that was itself retired later (a second
    normalization change), so each one is followed until it reaches a live
    organization. A chain that loops, or ends at an id with no organization
    row, leads nowhere and is left out rather than sending a visitor to a
    missing page. An old id that is live again answers for itself.
    """
    live = {r[0] for r in conn.execute("SELECT id FROM organizations")}
    step = {r[0]: r[1] for r in conn.execute("SELECT old_id, new_id FROM organization_aliases")}
    out: dict[str, str] = {}
    for old, target in step.items():
        if old in live:
            continue
        seen = {old}
        while target not in live and target in step and target not in seen:
            seen.add(target)
            target = step[target]
        if target in live:
            out[old] = target
    return out


def write_aliases(conn: sqlite3.Connection, out: Path) -> dict[str, int]:
    """aliases/<abc>.json: retired organization id -> live id, sharded on the retired id like the profiles.

    Why: a profile link shared before a normalization change names an id that
    no longer exists, and the site looks a missing id up here (in the file
    named like the profile shard it just missed in) to send the visitor on.
    Retired ids never go in the sitemap.
    """
    shards: dict[str, dict[str, str]] = defaultdict(dict)
    for old, new in resolve_aliases(conn).items():
        if ORG_ID_RE.match(old) and ORG_ID_RE.match(new):
            shards[shard_key(old)][old] = new
    for key in sorted(shards):
        _dump(out / "aliases" / f"{key}.json", shards[key])
    return {"alias_shards": len(shards)}


# -- aggregates: rankings, buyers, categories -------------------------------------------


class Totals:
    """The counted records (x_records) of each money source, per organization and per buyer, by year and in all.

    Each source is totalled on its own: a cell is (records, CAD total, records
    whose source published no value), and nothing here adds two sources
    together (CLAUDE.md "Counting money").
    """

    def __init__(self, m: Model) -> None:
        self.org: dict[tuple[int | str, str], dict[str, list]] = defaultdict(dict)
        self.buyer: dict[tuple[int | str, str], dict[str, list]] = defaultdict(dict)
        self.years: set[int] = set()
        for year, source, oid, buyer, n, total, no_value in m.conn.execute(
                "SELECT year, source, org, buyer, COUNT(*), SUM(v), SUM(nv) FROM x_records "
                "GROUP BY year, source, org, buyer"):
            keep = year is not None and FIRST_YEAR <= year <= m.year
            if keep:
                self.years.add(year)
            for table, key in ((self.org, oid), (self.buyer, buyer)):
                if key is None:
                    continue
                for y in ((year, "all") if keep else ("all",)):
                    cell = table[(y, source)].setdefault(key, [0, None, 0])
                    cell[0] += n
                    cell[2] += no_value or 0
                    if total is not None:
                        cell[1] = (cell[1] or 0) + total
        self.lobbying: dict[int | str, Counter] = defaultdict(Counter)
        for oid, day in m.conn.execute(
                "SELECT organization_id, comm_date FROM lobbying_communications WHERE organization_id IS NOT NULL"):
            self.lobbying["all"][oid] += 1
            year = _year_of(day)
            if year is not None and FIRST_YEAR <= year <= m.year:
                self.lobbying[year][oid] += 1
                self.years.add(year)


def write_rankings(m: Model, out: Path, totals: Totals) -> dict[str, int]:
    """rankings/all.json and rankings/<year>.json: the top organizations of each source by value and by count
    (lobbying by count only), and the top buyers of each money source."""
    years = sorted(totals.years, reverse=True)
    for which in ["all", *years]:
        sources: dict[str, dict[str, list[dict]]] = {}
        for source in MONEY_SOURCES:
            cells = [(oid, n, total, nv) for oid, (n, total, nv) in totals.org.get((which, source), {}).items()
                     if oid in m.orgs]
            if cells:
                sources[source] = {
                    "by_value": [m.org_total(*c) for c in
                                 _top((c for c in cells if c[2] is not None), RANK_ROWS, _by_value)],
                    "by_count": [m.org_total(*c) for c in _top(cells, RANK_ROWS, _by_count)],
                }
        lobby = [(oid, n, None) for oid, n in totals.lobbying.get(which, Counter()).items() if oid in m.orgs]
        if lobby:
            sources["lobbying"] = {"by_value": [],
                                   "by_count": [m.org_total(o, n, None) for o, n, _ in _top(lobby, RANK_ROWS, _by_count)]}
        buyers: dict[str, list[dict]] = {}
        for source in MONEY_SOURCES:
            cells = [(bid, n, total, nv) for bid, (n, total, nv) in totals.buyer.get((which, source), {}).items()
                     if bid in m.listed]
            ranked = _top(cells, RANK_BUYERS, _by_value)
            if ranked:
                buyers[source] = [{"id": b, "name_en": m.buyers[b]["name_en"], "name_fr": m.buyers[b]["name_fr"],
                                   "n": n, "total": _money(t), "n_no_value": nv} for b, n, t, nv in ranked]
        _dump(out / "rankings" / f"{which}.json",
              {"year": None if which == "all" else which, "years": years, "sources": sources, "buyers": buyers})
    return {"ranking_years": len(years)}


def top_organizations_year(m: Model, totals: Totals) -> list[dict]:
    """The data year's top organizations by award notice value (stats.json; the smoke test fetches the first)."""
    cells = [(oid, n, t, nv) for oid, (n, t, nv) in totals.org.get((m.year, "awards"), {}).items()
             if oid in m.orgs and t is not None]
    return [m.org_total(*c) for c in _top(cells, TOP_YEAR_ROWS, _by_value)]


BUYER_FIELDS = ("id", "name_en", "name_fr", "acronym_en", "acronym_fr", "kind", "n_tenders", "n_awards", "n_history",
                "n_contracts", "n_grants", "total_awards", "total_contracts", "total_grants", "n_awards_no_value",
                "n_contracts_no_value", "n_grants_no_value")


def write_buyers(m: Model, out: Path, totals: Totals, open_rows: list[dict]) -> dict[str, int]:
    """buyers/index.json and buyers/<id>.json for every listed buyer (Model.listed, export.LISTED_BUYER):
    a buyer with no open tender notice, award notice, contract history record, published contract or grant
    shows zero in every column of the list and is left out."""
    conn = m.conn
    listed = m.listed
    open_by: Counter = Counter(r["buyer_id"] for r in open_rows if r["buyer_id"])
    history_totals = totals.buyer.get(("all", "history"), {})
    summaries = []
    for bid in sorted(listed):
        b = m.buyers[bid]
        s = {k: b[k] for k in BUYER_FIELDS}
        for k in ("total_awards", "total_contracts", "total_grants"):
            s[k] = _money(s[k])
        s["n_open_tenders"] = open_by.get(bid, 0)
        s["total_history"] = _money(history_totals.get(bid, [0, None, 0])[1])
        s["n_history_no_value"] = history_totals.get(bid, [0, None, 0])[2]
        summaries.append(s)
    _dump(out / "buyers" / "index.json", {"buyers": summaries})
    years = _grouped(conn.execute("SELECT * FROM buyer_years ORDER BY buyer_id, year DESC, source"), "buyer_id")
    top: dict[str, dict[str, list[tuple]]] = defaultdict(dict)
    for source in MONEY_SOURCES:
        cells: dict[str, list[tuple]] = defaultdict(list)
        for bid, oid, n, total, nv in conn.execute(
                "SELECT buyer, org, COUNT(*), SUM(v), SUM(nv) FROM x_records WHERE source = ? AND buyer IS NOT NULL "
                "AND org IS NOT NULL GROUP BY buyer, org", (source,)):
            if oid in m.orgs:
                cells[bid].append((oid, n, total, nv))
        for bid, items in cells.items():
            top[bid][source] = _top(items, BUYER_TOP, _by_value)
    for s in summaries:
        bid = s["id"]
        b = m.buyers[bid]
        recent = [row for r in conn.execute(
            "SELECT * FROM x_awards WHERE buyer_id = ? ORDER BY published DESC, awarded DESC, reference LIMIT ?",
            (bid, BUYER_AWARDS * 2)) if (row := award_row(m, "awards", r))][:BUYER_AWARDS]
        _dump(out / "buyers" / f"{bid}.json", {
            "buyer": {**s, "ckan_org": b["ckan_org"], "department_number": b["department_number"]},
            "years": [{"year": y["year"], "source": y["source"], "n": y["n"], "total": _money(y["total"]),
                       "n_non_competitive": y["n_non_competitive"],
                       "total_non_competitive": _money(y["total_non_competitive"]),
                       "n_organizations": y["n_organizations"], "n_no_value": y["n_no_value"] or 0}
                      for y in years.get(bid, []) if y["source"] in MONEY_SOURCES],
            "top_organizations": {source: [m.org_total(*c) for c in ranked]
                                  for source, ranked in sorted(top.get(bid, {}).items()) if ranked},
            "open_tenders": s["n_open_tenders"],
            "recent_awards": recent,
            "expiring": m.expiring_part("buyer_id", bid),
        })
    aliases = {old: new for old, new in conn.execute("SELECT old_id, new_id FROM buyer_aliases ORDER BY old_id")
               if new in listed and old not in listed and _buyer_id(old)}
    _dump(out / "buyers" / "aliases.json", {"aliases": aliases})
    return {"buyers": len(summaries), "buyer_aliases": len(aliases)}


def write_categories(m: Model, out: Path, open_rows: list[dict]) -> dict[str, int]:
    """categories/index.json and one file per UNSPSC segment: its open notices, its award notices by year
    and its top organizations by award notice value (a notice with codes in two segments counts in each)."""
    open_by: dict[str, list[dict]] = defaultdict(list)
    for r in open_rows:
        for seg in r["segments"]:
            open_by[seg].append(r)
    n_all: Counter = Counter()
    nv_all: Counter = Counter()
    total_all: dict[str, float] = {}
    by_year: dict[str, dict[int, list]] = defaultdict(dict)
    orgs: dict[str, dict[str, list]] = defaultdict(dict)
    for r in m.conn.execute("SELECT org, awarded, v, nv, codes FROM x_awards"):
        year = _year_of(r["awarded"])
        for seg in m.segments_of(r["codes"]):
            n_all[seg] += 1
            nv_all[seg] += r["nv"] or 0
            cells = []
            if year is not None and FIRST_YEAR <= year <= m.year:
                cells.append(by_year[seg].setdefault(year, [0, None, 0]))
            if r["org"] in m.orgs:
                cells.append(orgs[seg].setdefault(r["org"], [0, None, 0]))
            for cell in cells:
                cell[0] += 1
                cell[2] += r["nv"] or 0
            if r["v"] is not None:
                total_all[seg] = total_all.get(seg, 0) + r["v"]
                for cell in cells:
                    cell[1] = (cell[1] or 0) + r["v"]
    index = []
    for code, (en, fr) in sorted(m.segments.items()):
        this_year = by_year[code].get(m.year, [0, None, 0])
        index.append({"code": code, "title_en": en, "title_fr": fr, "open_tenders": len(open_by[code]),
                      "awards_year_n": this_year[0], "awards_year_total": _money(this_year[1]),
                      "awards_year_n_no_value": this_year[2], "awards_n": n_all[code],
                      "awards_total": _money(total_all.get(code)), "awards_n_no_value": nv_all[code]})
        ranked = _top(((o, n, t, nv) for o, (n, t, nv) in orgs[code].items() if t is not None), CATEGORY_TOP, _by_value)
        _dump(out / "categories" / f"{code}.json", {
            "code": code, "title_en": en, "title_fr": fr, "open_tenders": open_by[code],
            "top_organizations": [m.org_total(*c) for c in ranked],
            "years": [{"year": y, "n": n, "total": _money(t), "n_no_value": nv}
                      for y, (n, t, nv) in sorted(by_year[code].items(), reverse=True)],
        })
    _dump(out / "categories" / "index.json", {"year": m.year, "segments": index})
    return {"categories": len(index)}


# -- the expiring-contracts radar ----------------------------------------------------


def write_expiring(m: Model, out: Path) -> dict[str, int]:
    """expiring/index.json and each window's pages (expiring.py builds the rows).

    Totals add each row's counted value, CAD only, once: the radar's duplicate
    rule leaves one source per contract, which is why these totals may add
    rows from different sources (the stated exception to CLAUDE.md rule 5).
    """
    items = m.expiring()
    windows = []
    counts: dict[str, int] = {"expiring_rows": len(items)}
    for name, days in expiring.WINDOWS:
        chosen = [item for item in items if item[0]["days_left"] <= days]
        total = _total(c for _, c in chosen)
        pages = [chosen[i:i + EXPIRING_PAGE] for i in range(0, len(chosen), EXPIRING_PAGE)]
        for n, page in enumerate(pages, start=1):
            _dump(out / "expiring" / name / f"{n}.json", [r for r, _ in page])
        _dump(out / "expiring" / name / "index.json", {"window": name, "pages": len(pages), "rows": len(chosen),
                                                        "total": total, "n_no_value": _no_value(chosen)})
        windows.append({"window": name, "n": len(chosen), "total": total, "n_no_value": _no_value(chosen)})
        counts[f"expiring_{name}"] = len(chosen)
    by_buyer: dict[str | None, list[tuple[dict, float | None]]] = defaultdict(list)
    by_segment: dict[str, list[tuple[dict, float | None]]] = defaultdict(list)
    for row, counted in items:
        by_buyer[row["buyer_id"]].append((row, counted))
        for seg in row["segments"]:
            by_segment[seg].append((row, counted))
    buyers = []
    for bid, rows in by_buyer.items():
        first = rows[0][0]
        buyers.append({"buyer_id": bid, "buyer_en": first["buyer_en"] if bid else None,
                       "buyer_fr": first["buyer_fr"] if bid else None, "n": len(rows),
                       "total": _total(c for _, c in rows), "n_no_value": _no_value(rows)})
    buyers = _top(buyers, EXPIRING_BUYERS, lambda b: (b["total"] is None, -(b["total"] or 0), -b["n"], b["buyer_id"] or ""))
    _dump(out / "expiring" / "index.json", {
        "as_of": m.as_of, "windows": windows, "by_buyer": buyers,
        "by_segment": [{"code": code, "n": len(rows), "total": _total(c for _, c in rows), "n_no_value": _no_value(rows)}
                       for code, rows in sorted(by_segment.items())],
    })
    return counts


# -- sitemaps -----------------------------------------------------------------------


def _lastmod(value: str | None) -> str | None:
    """The date part of an ISO date or datetime, or None for anything else."""
    return value[:10] if value and _DATE_RE.match(value) else None


def sitemap_entries(m: Model, skip: Collection[str] = ()) -> list[tuple[str, str | None]]:
    """(path, lastmod) for the fixed pages, then the organizations, buyers,
    categories, open and recent tenders, award years and directory pages.

    An organization's lastmod is its updated_at, which organizations.recompute
    rewrites only when something on the profile changed. skip names sections
    whose files were not written tonight (see _write_static), so their pages
    are left out rather than listed while they answer "not published".
    """
    conn = m.conn
    dated = m.as_of
    entries: list[tuple[str, str | None]] = [
        (p, dated if p in SITEMAP_DATED_PAGES else None) for p in SITEMAP_PAGES if p.strip("/") not in skip]
    entries += [(f"/organizations/{r['id']}", _lastmod(r["updated_at"]))
                for r in conn.execute("SELECT id, updated_at FROM organizations ORDER BY id")]
    if "buyers" not in skip:
        entries += [(f"/buyers/{r['id']}", _lastmod(r["updated_at"]))
                    for r in conn.execute("SELECT id, updated_at FROM buyers ORDER BY id") if r["id"] in m.listed]
    if "categories" not in skip:
        entries += [(f"/segments/{code}", dated) for code in sorted(m.segments)]
    # Open notices and every notice first seen in the last 30 days, each dated
    # by the night its newest version first appeared.
    recent = (m.today - timedelta(days=NEW_DAYS - 1)).isoformat()
    for r in conn.execute("SELECT reference, first_seen FROM x_tenders WHERE shown_status = 'open' OR first_sight >= ? "
                          "ORDER BY reference", (recent,)):
        ref = m.refs["tenders"].get(r["reference"])
        if ref:
            entries.append((f"/tenders/{ref.lower()}", _lastmod(r["first_seen"])))
    years = sorted({y for (a,) in conn.execute("SELECT DISTINCT substr(awarded, 1, 4) FROM x_awards")
                    if a and a.isdigit() and FIRST_YEAR <= (y := int(a)) <= m.year}, reverse=True)
    entries += [(f"/awards/{y}", dated) for y in years]
    if "expiring" not in skip:
        entries += [(f"/expiring/{name}", dated) for name, _ in expiring.WINDOWS]
    if "directory" not in skip:
        entries += directory.sitemap_entries(conn)
    return entries


def sitemap_chunks(entries: Sequence, max_urls: int = SITEMAP_MAX_URLS) -> list[Sequence]:
    return [entries[i:i + max_urls] for i in range(0, len(entries), max_urls)]


def _xml(lines: list[str]) -> bytes:
    return ("\n".join(['<?xml version="1.0" encoding="UTF-8"?>', *lines]) + "\n").encode("utf-8")


def _entry(tag: str, loc: str, lastmod: str | None) -> str:
    stamp = f"<lastmod>{lastmod}</lastmod>" if lastmod else ""
    return f"<{tag}><loc>{escape(loc)}</loc>{stamp}</{tag}>"


def write_sitemaps(entries: Sequence[tuple[str, str | None]], out: Path, base_url: str,
                   max_urls: int = SITEMAP_MAX_URLS) -> dict[str, int]:
    """Write sitemaps/sitemap-<n>.xml and the index that lists them.

    URLs are absolute, as the protocol requires, on base_url. The index names
    each part at the site root (/sitemap-<n>.xml), where the site serves it,
    with the newest lastmod inside that part.
    """
    base = base_url.rstrip("/")
    folder = out / "sitemaps"
    folder.mkdir(parents=True, exist_ok=True)
    index: list[str] = []
    chunks = sitemap_chunks(entries, max_urls)
    for n, chunk in enumerate(chunks, start=1):
        lines = [f'<urlset xmlns="{SITEMAP_NS}">', *(_entry("url", base + path, mod) for path, mod in chunk), "</urlset>"]
        (folder / f"sitemap-{n}.xml").write_bytes(_xml(lines))
        dates = [mod for _, mod in chunk if mod]
        index.append(_entry("sitemap", f"{base}/sitemap-{n}.xml", max(dates) if dates else None))
    (folder / "index.xml").write_bytes(_xml([f'<sitemapindex xmlns="{SITEMAP_NS}">', *index, "</sitemapindex>"]))
    return {"sitemap_files": len(chunks), "sitemap_urls": len(entries)}


# -- the export ---------------------------------------------------------------------


def tree_size(root: Path) -> dict[str, object]:
    """Files, bytes, the five largest files and the files over the deploy's per-file cap."""
    sizes = sorted(((p.stat().st_size, p.relative_to(root).as_posix()) for p in root.rglob("*") if p.is_file()),
                   key=lambda s: (-s[0], s[1]))
    return {"files": len(sizes), "bytes": sum(s for s, _ in sizes), "largest": sizes[:5],
            "over_cap": [name for size, name in sizes if size > MAX_FILE_BYTES]}


def export_static(conn: sqlite3.Connection, out_dir: Path | None = None, *, today: date | None = None,
                  base_url: str | None = None) -> dict[str, int]:
    final = out_dir or (config.OUT_DIR / "static")
    # Written beside the final folder and moved into place only when every
    # file is written, so a failure part way leaves the previous export (or
    # none at all) rather than a half-written tree the deploy would publish.
    out = final.with_name(final.name + ".partial")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    try:
        counts = _write_static(conn, out, today or datetime.now(timezone.utc).date(), base_url or config.SITE_URL)
    except BaseException:
        shutil.rmtree(out, ignore_errors=True)
        raise
    finally:
        drop_temp(conn)
    size = tree_size(out)
    counts["files"], counts["bytes"] = size["files"], size["bytes"]
    notice = None
    if size["files"] > MAX_FILES or size["over_cap"]:
        # The verify step refuses this export; the run log says why first.
        first = f": {size['over_cap'][0]}" if size["over_cap"] else ""
        notice = f"{size['files']} files (limit {MAX_FILES}); {len(size['over_cap'])} files over 25 MiB{first}"
        log.warning("export: %s", notice)
    if final.exists():
        shutil.rmtree(final)
    out.rename(final)
    log.info("export: %d files, %d bytes; largest %s", size["files"], size["bytes"],
             ", ".join(f"{name} ({n} bytes)" for n, name in size["largest"]))
    detail = " ".join(f"{k}={v}" for k, v in counts.items())
    log_run(conn, "export", detail=f"static {detail}"[:900], rows_in=counts.get("organizations", 0),
            rows_new=size["files"], notice=notice)
    return counts


def _write_static(conn: sqlite3.Connection, out: Path, today: date, base_url: str) -> dict[str, int]:
    set_meta(conn, "data_as_of", today.isoformat())
    conn.commit()
    m = Model(conn, today)
    counts: dict[str, int] = {}

    # The core: the files every page and the deploy's checks read. Any failure
    # here fails the export, and the previous one stays published.
    open_rows, new_today, tender_counts = write_tender_lists(m, out)
    counts.update(tender_counts)
    counts.update(write_tender_shards(m, out))
    counts.update(write_contract_shards(m, out))
    counts.update(write_award_lists(m, out))
    totals = Totals(m)

    # The sections. Each comes from its own aggregation, and the site answers
    # "not published" for a section whose files are missing, so one bad value
    # in one of them must not hold back the night's data for every other
    # page: a section that fails is logged as a stage of its own (the run
    # status reports it), its files stay unwritten and the sitemap leaves its
    # pages out until an export writes them again.
    failed: set[str] = set()
    sections: tuple[tuple[str, Callable[[], dict[str, int]]], ...] = (
        ("feeds", lambda: write_feeds(conn, out, today=today, base_url=base_url)),
        ("buyers", lambda: write_buyers(m, out, totals, open_rows)),
        ("categories", lambda: write_categories(m, out, open_rows)),
        ("rankings", lambda: write_rankings(m, out, totals)),
        ("expiring", lambda: write_expiring(m, out)),
        ("aliases", lambda: write_aliases(conn, out)),
        ("directory", lambda: directory.write_all(conn, out, m.as_of)),
    )
    for name, write in sections:
        try:
            counts.update(write())
        except Exception as exc:
            log.exception("export: the %s section failed", name)
            failed.add(name)
            log_run(conn, f"export_{name}", detail=f"{type(exc).__name__}: {exc}"[:900], ok=False)

    counts.update(write_profiles(conn, out, m))
    stats_counts = {
        "organizations": len(m.orgs),
        # The buyers with a record in a column the list shows (Model.listed).
        "buyers": len(m.listed),
        "tenders_open": len(open_rows),
        "tenders_new_today": len(new_today),
        # The whole count, where the home page's list holds twelve rows.
        "tenders_closing_soon": len(closing_soon(m, open_rows)),
        "awards": conn.execute("SELECT COUNT(*) FROM x_awards").fetchone()[0],
        # One per reference, as awards/<year>/index.json counts the year's rows.
        "awards_year": conn.execute("SELECT COUNT(*) FROM x_awards WHERE substr(awarded, 1, 4) = ?",
                                    (str(m.year),)).fetchone()[0],
        "history": conn.execute("SELECT COUNT(*) FROM x_history").fetchone()[0],
        "contracts": conn.execute("SELECT COUNT(*) FROM contracts").fetchone()[0],
        "grants": conn.execute("SELECT COUNT(*) FROM x_grants").fetchone()[0],
        "lobbying": conn.execute("SELECT COUNT(*) FROM lobbying_communications").fetchone()[0],
    }
    write_stats(m, out, counts=stats_counts, open_rows=open_rows, new_today=new_today,
                top_year=top_organizations_year(m, totals))
    counts.update(write_sitemaps(sitemap_entries(m, failed), out, base_url))
    counts["organizations"] = len(m.orgs)
    return counts
