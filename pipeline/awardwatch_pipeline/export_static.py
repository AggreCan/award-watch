"""Static JSON export: the files the site serves as assets.

Why static: a read-heavy public dataset costs nothing per row when page views
read files. The site ships the data as JSON files beside the Worker (static
assets are free to serve), list pages filter in the browser, and a detail page
reads one small shard. The database stays on the operator's side.

The layout is the contract in CLAUDE.md "Static export layout"; the site's
loaders (site/src/data.ts) check every field they render and answer "not
published" for a file that does not read, so a shape change here goes with a
change there. Output tree (under data/out/static):

  stats.json                    counts (with awards_30d, the award notices awarded in the AWARDS_RECENT_DAYS
                                days to the data date, awards_year_suppliers, the organizations the
                                year's notices name, and awards_erroneous, the award notices whose award
                                date falls after the data date), today's notices, closing soon, the closing values of
                                every open notice closing within CLOSING_TIMES_DAYS (closing_soon_times:
                                the site counts closing soon from them at render), recent awards, the
                                year's top organizations by awards value, the last runs, the source files
                                read (source_files: one row per file read and one per source never read,
                                each with last_read, last_modified as an ISO instant, last_modified_http as
                                the publisher sent it, and loaded), totals (awards_year: the data year's
                                award notices by the counting rules, CAD; awards_30d: the notices
                                counts.awards_30d counts, the same way), downloads (each file of the CSV
                                export the Data page offers: file, bytes, and rows under the header, the
                                lines of SHA256SUMS; empty when the CSV folder is missing) and map (the home
                                page's Canada map, province_map: for each of its layers new_today, the
                                notices first seen on the data date as tenders/new/<data date>.json lists
                                them, open, every open notice, and closing_7d, the notices of closing_soon,
                                an object {n, not_stated, provinces}: n the layer's notices, provinces every
                                one of the thirteen codes with the notices placed in it, stated or derived,
                                zeros kept, a notice placed in several provinces counted in each, and
                                not_stated the notices placed in none, Canada-wide or not stated. The fourth
                                layer, the same-day notices, is the site's own: it counts the rows the
                                intraday job writes, which this file never sees), and matching_fy, the first
                                and last fiscal year the profiles' "matching" blocks count (below)
  tenders/open.json             every notice open on the data date as a list row (read by the browser only)
  tenders/open-first.json       the open notices closing by the day after the data date and the 50 after
                                them, the number open, and the facet counts over all of them (what
                                /tenders and the home page render on the server: a notice whose closing
                                time passes before the next nightly sorts last there, and the rows
                                after it still fill the first page)
  tenders/open-levels.json      the UNSPSC families and classes the open notices carry, each with the notices
                                carrying a code in it and its name as the notices give it (the segment
                                pages' levels and the tender list's code filter read it)
  tenders/new/<day>.json        the notices first seen on each of the last 30 days
  tenders/<abc>.json            every notice in the database, detail form, sharded on the reference; a notice
                                that names documents carries attachments [{url, name}] (tender_attachments: the
                                newest version's links, https on a Government of Canada host, 50 at most; name is
                                the last segment of the URL's path, percent-decoded); one with none has no such key.
                                A notice carries description_cut, {"en": n, "fr": n} for each description the loader
                                cut at its last whole word within n characters, {} when both are whole; absent for a
                                version stored before the loader recorded its cut, which the site reads by length
  contracts/<abc>.json          award notices and contract history records, detail form, same sharding,
                                keyed "award:<reference>" and "history:<reference>", with description_cut as on a
                                tender notice; a history record whose
                                supplier PSPC gives a number of employees for carries supplier_employees
                                (normalize.employee_count: a count's digits or a size band's code, from the
                                newest version that states one); a withheld supplier's record never does
  awards/recent.json            the 500 most recently published award notices whose award date is not after
                                the data date
  awards/erroneous.json         the award notices whose award date falls after the data date, newest award
                                date first, ERRONEOUS_AWARDS at most: the list row with published, start and
                                end (the contract's dates) beside it
  awards/<year>/index.json      a year's page count and row count, and value_pages and valued_pages, the
                                value set's file count and the first of them that hold a value
  awards/<year>/<n>.json        the year's award notices, newest award date first, 500 to a page
  awards/<year>/value/<n>.json  the same rows ordered by value (by_award_value): those with a value in
                                Canadian dollars (or no stated currency) largest first, then from a file of
                                their own those without one, newest award date first; 500 to a page, so the
                                set has one file more than the date set at most. The site reads the
                                largest values in file order, the smallest by reversing the first
                                valued_pages files, and the oldest by reversing the date set
  profiles/<abc>.json           organization profiles, sharded on the id's characters 5 to 7; a member of a
                                corporate family (families.py) carries family {name, members: [{id,
                                display_name, n_records, note}]}, the members by records, itself among them,
                                FAMILY_MEMBERS at most, each with its own count and never a combined figure
                                (profile_families); a profile in no family has no such key. A profile that
                                other profiles were merged into (merges.py) carries aliases [{id, name, note,
                                reason}], for "Also appears as": id the retired id (its redirect below), name
                                the name its own profile showed, note the seed's word for the tie (spelling,
                                former, short, branch; null for a rule's merge), reason the merge's rule
                                (business_number, truncation, spelling, seed); names with a note first, then
                                by records, PROFILE_ALIASES at most, aliases_total_rows beside them when more
                                (profile_aliases); a profile nothing was merged into has neither key. A
                                profile with a history record that gives the supplier's employees carries
                                employees {value, awarded, reference}: the figure on its newest such record
                                (the history list's order), that record's award date and URL reference
                                (profile_employees); one with none has no such key. A profile with a
                                record or a held instrument in the MATCH_YEARS fiscal years to the data
                                date's carries matching, the counts the site ranks open notices by for an
                                account that names the organization (profile_matching.py has the block and
                                its rules); one with none has no such key. A profile with a payee row of the
                                Public Accounts linked to it in the newest public_accounts.PA_FREE_YEARS fiscal
                                years carries public_accounts (sources/public_accounts.profile_blocks): payments
                                in a fiscal year, a block of their own that no figure of the profile adds
  aliases/<ab>.json            retired organization id -> the live id that took its records, sharded on the
                                id's characters 5 and 6 (256 files at most: 27,000 merged ids on 4,096
                                shards pushed the export past the file cap on 2026-11-02): retired by a
                                normalization change (migrate.py) or merged into another organization
                                (merges.py); the site redirects a missing profile by it. The names travel
                                on the live profile (aliases above), not here: these shards are keyed by
                                the retired id, which the live profile cannot look up, and the redirect
                                reads each value as an id
  directory/...                 organizations A to Z by province (directory.py)
  buyers/index.json, buyers/<id>.json   the listed buyers (export.LISTED_BUYER): those with an open notice,
                                an award notice, a contract history record, a published contract or a grant,
                                and the institutions only the lobbying registry names (kind "institution",
                                with n_lobbying); a buyer file's "aliases" are the names it also appears under
                                (buyer_aliases_of); a buyer with a class of the newest Public Accounts file
                                carries public_accounts (sources/public_accounts.buyer_blocks), apart from its
                                contract figures; a buyer an institution of the Indigenous procurement target's
                                files resolves to carries indigenous_target (sources/indigenous_target.buyer_blocks):
                                its plan, gaps and result as reported, apart from every contract figure
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
  instruments/index.json        the standing offers and supply arrangements with an active holder
                                (sosa_export.py, which also names what profiles, segment and buyer files and
                                tender details carry of them: "instruments" and "holders")
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

Award dates after the data date. Some award notices carry an award date
years ahead, and in every such row seen it is the contract's end date entered
in the award-date field. Such a notice is left out of the newest lists
(stats.json recent_awards, awards/recent.json, a buyer file's recent_awards)
and listed apart in awards/erroneous.json; a profile's awards and history and
a tender's related awards keep it, ordered by its publication date
(award_day), with its award date as published. A year page lists it under its
award date's year while that year is not after the data date's. An award date
up to the data date is left alone, even one a day or two after publication.

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
that is PSPC). A radar row whose published contract reports a set-aside under
the Procurement Strategy for Indigenous Business, or an Indigenous business
outside one, carries indigenous (MS, VS or IB, expiring.py); any other row has
no such key.

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
from urllib.parse import unquote, urlsplit
from xml.sax.saxutils import escape

from . import config, directory, expiring, indicators, organizations, profile_matching, sosa_export, value_checks
from .db import get_meta, log_run, set_meta
from .export import SUMS, listed_buyer_ids, register_functions, scrub, scrub_doc
from .feeds import write_feeds
from .normalize import INDIGENOUS_MARKS, PROVINCE_CODES, closing_day, employee_count, norm_name, org_id, tender_status_on
from .sources import buyers as buyer_rules
from .sources import indigenous_target, public_accounts
from .sources.buyers import public_spelling
from .sources.canadabuys_rows import ATTACHMENTS_MAX, government_url
from .sources.matching import is_person_name
from .sources.sosa import stem as sosa_stem

log = logging.getLogger(__name__)

HOME_ROWS = 12
TOP_YEAR_ROWS = 8
RECENT_AWARDS = 500
# awards/erroneous.json: the award notices dated after the data date, at most this many.
ERRONEOUS_AWARDS = 500
AWARD_PAGE = 500
OPEN_FIRST_ROWS = 50
# open-first.json also holds every notice closing up to this many days after
# the data date: the site reads closing times at render, and those are the
# notices that can close before the next nightly.
OPEN_FIRST_MARGIN_DAYS = 1
NEW_DAYS = 30
# A notice counts as new on the day it is first seen only when it was
# published within this many days before: the first load reads every notice
# since 2022 and sees them all that night, and none of those is news.
NEW_LAG_DAYS = 7
CLOSING_SOON_DAYS = 7
# stats.json closing_soon_times covers the window and two days more, so a
# page read a day or two after the nightly still counts from the file.
CLOSING_TIMES_DAYS = CLOSING_SOON_DAYS + 2
# The home page's award notices tile counts those awarded in this many days
# to the data date, the data date included, as the new notices' list does.
AWARDS_RECENT_DAYS = 30
PROFILE_ROWS = 100
# CLAUDE.md's profile contract: the newest 50 lobbying communications.
LOBBYING_ROWS = 50
PROFILE_NAMES = 10
PROFILE_PLACES = 10
PROFILE_BUYERS = 10
# A profile's family block lists at most this many members (families.py).
FAMILY_MEMBERS = 50
# The profiles merged into an organization that its profile lists at most ("Also appears as", profile_aliases).
PROFILE_ALIASES = 12
BUYER_TOP = 25
BUYER_AWARDS = 50
# The other names a buyer page lists at most ("Also appears as").
BUYER_ALIASES = 12
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
# The same for a tender notice's shard, which holds up to
# canadabuys_rows.TENDER_DESCRIPTION_MAX characters of each description in
# each language (2026-11-13: the largest of 64 live shards 67 KB, the cap
# adding 91 KB to a shard at most).
TENDER_SHARD_WARN = 300 * 1024
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
_ISO_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
TEMP_TABLES = ("x_tenders", "x_awards", "x_history", "x_grants", "x_records", "x_proc")

# Half the protocol's 50,000 URLs to a file: the Worker serves each part with
# every page twice, the English address and the French one (?lang=fr), each
# carrying the language alternates (site/src/sitemaps.ts SITEMAP_PART_MAX,
# which site/test/seo-intent.test.ts holds equal to this).
SITEMAP_MAX_URLS = 25_000
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
# /pro, /tenders/same-day and /analytics answer while the site's accounts
# switch is on, as it is in production; the published contracts' pages are
# listed by the Worker from the records database (/sitemap-contracts-<n>.xml).
# /overview is the site's app home at its own address, the same page for every
# reader; "/" is the landing page for a reader without a session.
SITEMAP_PAGES = ["/", "/overview", "/tenders", "/tenders/new", "/tenders/same-day", "/awards", "/awards/erroneous",
                 "/expiring", "/organizations", "/buyers", "/segments", "/analytics", "/rankings", "/feeds", "/watchlist",
                 "/data", "/methodology", "/cite", "/corrections", "/about", "/terms", "/privacy", "/alerts", "/pro"]
# Pages whose content follows the nightly data carry its date; the others
# change only with the code, so they carry none rather than a false one.
SITEMAP_DATED_PAGES = {"/", "/overview", "/tenders", "/tenders/new", "/awards", "/awards/erroneous", "/expiring",
                       "/organizations", "/buyers", "/segments", "/analytics", "/rankings", "/feeds", "/data"}


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


def _places(row: dict, r: sqlite3.Row) -> dict:
    """The derived provinces beside the stated ones (places.py), only on a row that has them: provinces_derived,
    never one of its provinces, and provinces_from, the field they come from."""
    derived = [p for p in _codes(r["provinces_derived"]) if p not in row["provinces"]]
    if derived and r["provinces_from"]:
        row["provinces_derived"] = derived
        row["provinces_from"] = r["provinces_from"]
    return row


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


def award_day(as_of: str) -> str:
    """The SQL date an award notice or history record is ordered by: its award date, or its publication date when
    the award date falls after the data date. In every such row seen the award date is the contract's end date
    entered in the award-date field, so the row is placed when it appeared rather than first for years.

    as_of is the export's own data date, never a visitor's value; it is checked to read as a date before it goes
    into the statement as a literal, as the profile queries share one tuple of bound values.
    """
    if not _ISO_DAY.fullmatch(as_of):
        raise ValueError(f"{as_of!r} is not a date")
    return f"CASE WHEN substr(awarded, 1, 10) > '{as_of}' THEN published ELSE awarded END"


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
    newest version withholds its supplier links to no organization (x_history
    adds employees, the supplier employees its newest stating version gives,
    normalize.employee_count; both carry notice_type_en, which the profile's
    "matching" block counts, profile_matching.py); value is
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
    # A history record's supplier employees: the newest version's that states them (employee_count), for the
    # profile's figure (profile_employees).
    employees = ("(SELECT employee_count(z.supplier_employee_count) FROM contract_history z WHERE z.reference = n.reference "
                 "AND employee_count(z.supplier_employee_count) IS NOT NULL ORDER BY z.amendment DESC LIMIT 1) AS employees, ")
    for table, temp, codes, extra, kind in (
        ("awards", "x_awards", "award_codes", "", "award"),
        ("contract_history", "x_history", "history_codes", "n.client_id, n.client_raw_en, n.client_raw_fr, " + employees,
         "history"),
    ):
        conn.execute(
            f"CREATE TEMP TABLE {temp} AS WITH newest AS ({organizations._newest_by_reference(table, ('reference',))}) "
            "SELECT n.reference, n.amendment, n.solicitation, "
            "CASE WHEN n.supplier_withheld = 1 THEN NULL ELSE n.org END AS org, n.supplier_withheld, "
            "n.title_en, n.title_fr, n.buyer_id, n.buyer_raw_en, n.buyer_raw_fr, " + extra +
            "n.published, n.awarded, n.start, n.\"end\", n.currency, n.status, n.competitive, n.instrument_type_en, "
            "n.instrument_type_fr, n.provinces, n.provinces_derived, n.provinces_from, n.notice_type_en, "
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

# The open list's rows carry this much of a notice's description, so the list
# page's word filter reads it too (tenders/open.json is about 1 MB with it).
EXCERPT_CHARS = 200
_SPACES = re.compile(r"\s+")


def excerpt(text: object, lang: str) -> str | None:
    """The start of a description for the open list: scrubbed of contacts first (a cut could split an address
    or a telephone number the scrub would no longer see), whitespace folded, cut at a word boundary within
    EXCERPT_CHARS with an ellipsis."""
    if not isinstance(text, str) or not text.strip():
        return None
    clean = _SPACES.sub(" ", str(scrub(text, lang))).strip()
    if len(clean) <= EXCERPT_CHARS:
        return clean
    cut = clean[:EXCERPT_CHARS + 1]
    space = cut.rfind(" ")
    return (cut[:space] if space > EXCERPT_CHARS // 2 else cut[:EXCERPT_CHARS]).rstrip(" ,;:.") + "…"


WORD_FIELDS = ("excerpt_en", "excerpt_fr", "codes")


def list_fields(row: dict) -> dict:
    """An open-list row without what only the open list's filters read (a segment's file, the home lists)."""
    return {k: v for k, v in row.items() if k not in WORD_FIELDS}


def full_codes(codes: object) -> list[str]:
    """A notice's UNSPSC codes as stored (the newest amendment's), digits only, sorted: the list page filters a
    family (4 digits) or a class (6) by prefix."""
    return sorted({c for c in str(codes or "").split() if c.isdigit() and 2 <= len(c) <= 8})


def tender_row(m: Model, r: sqlite3.Row, *, status: bool = False, words: bool = False) -> dict | None:
    """A notice as a list row. words adds what the open list's filters read beyond the list fields: the start of
    the description in each language and the full UNSPSC codes."""
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
    _places(row, r)
    if ref != r["reference"]:
        row["reference_published"] = r["reference"]
    if words:
        row["excerpt_en"] = excerpt(r["description_en"], "en")
        row["excerpt_fr"] = excerpt(r["description_fr"], "fr")
        row["codes"] = full_codes(r["codes"])
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
    _places(row, r)
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
    _places(row, r)
    if withheld:
        row["supplier_withheld"] = True
    elif r["indigenous"] in INDIGENOUS_MARKS:
        # The published contracts' Indigenous business mark (expiring.py), only when set.
        row["indigenous"] = r["indigenous"]
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
SOURCE_ORDER = ("buyers", "tenders", "awards", "history", "contracts", "grants", "lobbying", "registry",
                public_accounts.STATS_SOURCE, indigenous_target.STATS_SOURCE)
# The file a source's row names until a read records its own (a source never read yet).
SOURCE_DEFAULT_FILE = {
    "buyers": "organization_show",
    "tenders": config.TENDERS_COMPLETE_FILE,
    "awards": config.AWARDS_COMPLETE_FILE,
    "history": config.HISTORY_COMPLETE_FILE,
    **SOURCE_FILES,
    "registry": "corporations-active-cbca-en.csv",
    public_accounts.STATS_SOURCE: public_accounts.STATS_DEFAULT_FILE,
    indigenous_target.STATS_SOURCE: indigenous_target.STATS_DEFAULT_FILE,
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
    # The Public Accounts' yearly files, one row each (pa_files); a fault here leaves the default row.
    try:
        for row in public_accounts.source_rows(conn, http_date_iso):
            entry(row["source"], row["file"]).update(row)
    except sqlite3.Error as exc:
        log.warning("export: the Public Accounts files could not be listed: %s", exc)
    # The Indigenous procurement target's files applied, one row each, the same way.
    try:
        for row in indigenous_target.source_rows(conn, http_date_iso):
            entry(row["source"], row["file"]).update(row)
    except sqlite3.Error as exc:
        log.warning("export: the Indigenous procurement target files could not be listed: %s", exc)
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


def closing_soon_times(m: Model, open_rows: list[dict]) -> list[str]:
    """The closing values of the open notices whose closing day falls within CLOSING_TIMES_DAYS of the data
    date, soonest first: the site counts closing soon from them at render (src/closing.ts)."""
    end = (m.today + timedelta(days=CLOSING_TIMES_DAYS)).isoformat()
    return [r["closing"] for r in open_rows if (day := closing_day(r["closing"])) and m.as_of <= day <= end]


def province_counts(rows: Iterable[dict]) -> dict:
    """One layer of the home page's Canada map: n, the notices; provinces, each of the thirteen province and
    territory codes with the notices placed in it, by a stated province or a derived one (the province filter's
    default reading), zeros kept so the site never reads a missing code as a guess; and not_stated, the notices
    placed in none. A notice placed in several provinces counts in each, so the provinces can add up to more
    than n; one placed in none counts once, in not_stated, so n - not_stated notices are on the map."""
    provinces = dict.fromkeys(sorted(PROVINCE_CODES), 0)
    n = not_stated = 0
    for r in rows:
        n += 1
        placed = {p for p in (*r["provinces"], *(r.get("provinces_derived") or ())) if p in provinces}
        if not placed:
            not_stated += 1
        for p in placed:
            provinces[p] += 1
    return {"n": n, "not_stated": not_stated, "provinces": provinces}


def province_map(m: Model, open_rows: list[dict], new_today: list[dict]) -> dict:
    """stats.json "map": the layers of the home page's Canada map the nightly can count. new_today is every row
    of tenders/new/<data date>.json (a notice closed since counts too, as /tenders/new lists it), open every
    open notice, closing_7d the closing-soon notices of the data date."""
    return {"new_today": province_counts(new_today), "open": province_counts(open_rows),
            "closing_7d": province_counts(closing_soon(m, open_rows))}


def open_first(m: Model, open_rows: list[dict]) -> list[dict]:
    """The rows of tenders/open-first.json: every open notice closing by OPEN_FIRST_MARGIN_DAYS after the data
    date (open_rows is soonest first), then OPEN_FIRST_ROWS more."""
    end = (m.today + timedelta(days=OPEN_FIRST_MARGIN_DAYS)).isoformat()
    early = sum(1 for r in open_rows if (day := closing_day(r["closing"])) is not None and day <= end)
    return open_rows[:early + OPEN_FIRST_ROWS]


def _csv_rows(path: Path) -> int:
    """The records under a CSV file's header, read as CSV: a description holding a line break is one record."""
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return max(0, sum(1 for _ in csv.reader(fh)) - 1)


def download_files(csv_dir: Path | None, rows: dict[str, int] | None = None) -> list[dict]:
    """The Data page's downloads as the CSV export left them, by file name: each file's size in bytes and its
    rows under the header (SHA256SUMS: its lines, one a file). rows is the export's own count per file
    (export.export_csv returns it); a file it does not name is counted here. Empty when the folder is missing."""
    if csv_dir is None or not csv_dir.is_dir():
        return []
    out = []
    for path in sorted(csv_dir.iterdir(), key=lambda p: p.name):
        if not path.is_file() or not (path.name.endswith(".csv") or path.name == SUMS):
            continue
        if rows is not None and path.name in rows:
            n = rows[path.name]
        elif path.name == SUMS:
            n = sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
        else:
            n = _csv_rows(path)
        out.append({"file": path.name, "bytes": path.stat().st_size, "rows": n})
    return out


def write_stats(m: Model, out: Path, *, counts: dict[str, int], open_rows: list[dict], new_today: list[dict],
                top_year: list[dict], downloads: list[dict] | None = None) -> dict:
    conn = m.conn
    # The home page's award notices: the newest by award date, the order its Awarded column reads in, so a
    # notice published today for a contract awarded months ago does not stand above this week's awards. A
    # date after the data date is the contract's end date typed in the award-date field ("2029") and would head
    # the list for good; it is left out here, as from every newest list (awards/erroneous.json lists it apart),
    # and so is a notice with no award date.
    recent = [row for r in conn.execute(
        "SELECT * FROM x_awards WHERE substr(awarded, 1, 10) <= ? "
        "ORDER BY substr(awarded, 1, 10) DESC, published DESC, reference LIMIT ?", (m.as_of, HOME_ROWS * 2))
        if (row := award_row(m, "awards", r))][:HOME_ROWS]
    runs = [{"run_at": r["run_at"], "source": r["source"], "detail": (r["detail"] or "")[:300] or None,
             "rows_new": r["rows_new"], "ok": r["ok"]}
            for r in conn.execute("SELECT run_at, source, detail, rows_new, ok FROM sources_log ORDER BY id DESC LIMIT ?",
                                  (RUN_ROWS,))]
    # The figures beside the year's award notices on the home page: those awarded in the last
    # AWARDS_RECENT_DAYS days and what they add up to (CAD, the rules' v), and the organizations the year's
    # notices name (one whose supplier is withheld names none).
    first_day = (m.today - timedelta(days=AWARDS_RECENT_DAYS - 1)).isoformat()
    recent_n, recent_v = conn.execute(
        "SELECT COUNT(*), SUM(v) FROM x_awards WHERE substr(awarded, 1, 10) BETWEEN ? AND ?", (first_day, m.as_of)).fetchone()
    suppliers = conn.execute("SELECT COUNT(DISTINCT org) FROM x_awards WHERE substr(awarded, 1, 4) = ? AND org IS NOT NULL",
                             (str(m.year),)).fetchone()[0]
    stats = {
        "data_as_of": m.as_of,
        "counts": {**counts, "awards_30d": recent_n, "awards_year_suppliers": suppliers},
        "new_tenders": sorted(new_today, key=lambda r: (r["published"] or "", r["reference"]), reverse=True)[:HOME_ROWS],
        "closing_soon": [list_fields(r) for r in closing_soon(m, open_rows)[:HOME_ROWS]],
        "closing_soon_times": closing_soon_times(m, open_rows),
        "recent_awards": recent,
        "top_organizations_year": top_year,
        "runs": runs,
        "sources": source_files(conn),
        # The value beside the year's count on the home page: what its award notices add up to (CAD, the rules' v).
        "totals": {"awards_year": _money(conn.execute(
            "SELECT SUM(v) FROM x_awards WHERE substr(awarded, 1, 4) = ?", (str(m.year),)).fetchone()[0]),
                   "awards_30d": _money(recent_v)},
        "downloads": downloads or [],
        "map": province_map(m, open_rows, new_today),
        # The fiscal years the profiles' "matching" blocks count: its presence tells the site that a profile
        # without a block has nothing in them, rather than predating the block.
        "matching_fy": list(profile_matching.window(m.as_of)),
    }
    _dump(out / "stats.json", stats)
    return stats


# -- tenders ------------------------------------------------------------------------


FACETS = ("category", "segment", "province", "buyer", "notice_type", "method")


def tender_facets(rows: list[dict]) -> dict[str, list[dict]]:
    """Counts over every open notice for the filter bar: a code for category,
    segment and province; a buyer id with its names; the English text of a
    notice type or method with both labels. Most notices first. A province
    counts the notices that state it or have it derived, as the filter reads
    them unless asked for the stated ones alone."""
    counts: dict[str, Counter] = {f: Counter() for f in FACETS}
    labels: dict[str, dict[str, tuple[str | None, str | None]]] = {f: {} for f in FACETS}
    for r in rows:
        counts["category"].update(set(r["category"]))
        counts["segment"].update(set(r["segments"]))
        counts["province"].update(set(r["provinces"]) | set(r.get("provinces_derived") or ()))
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


# The levels below a segment the code filter takes, by the digits of their codes: a family is 4, a class 6.
LEVEL_DIGITS = (4, 6)
# At most this many families and classes in tenders/open-levels.json, those with the most open notices, so
# the file stays small whatever the open list becomes (the server reads it for a segment page).
LEVELS_MAX = 4000


def tender_levels(m: Model, open_rows: list[dict]) -> list[dict]:
    """The UNSPSC families and classes the open notices carry, in code order: each with n, the notices carrying
    a code in it (a notice counts once in each), and its name in each language as the notices published it,
    null when no notice used the family's or class's own code (the source names only the codes it uses)."""
    counts: Counter = Counter()
    for r in open_rows:
        counts.update({c[:k] for c in r.get("codes", []) for k in LEVEL_DIGITS if len(c) >= k})
    kept = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:LEVELS_MAX]
    out = []
    for code, n in sorted(kept):
        en, fr = m.unspsc.get(code, (None, None))
        out.append({"code": code, "en": en, "fr": fr, "n": n})
    return out


def write_tender_lists(m: Model, out: Path) -> tuple[list[dict], list[dict], dict[str, int]]:
    """tenders/open.json, tenders/open-first.json, tenders/open-levels.json and tenders/new/<day>.json.

    Returns the open rows (soonest closing first), today's new rows, and counts.
    A day of the last 30 with no new notice gets an empty list, so the page
    says none rather than "not published".
    """
    conn = m.conn
    open_rows = [row for r in conn.execute(
        "SELECT * FROM x_tenders WHERE shown_status = 'open' ORDER BY closing IS NULL, closing, reference")
        if (row := tender_row(m, r, words=True))]
    _dump(out / "tenders" / "open.json", open_rows)
    _dump(out / "tenders" / "open-first.json", {
        "total": len(open_rows), "rows": open_first(m, open_rows), "facets": tender_facets(open_rows)})
    _dump(out / "tenders" / "open-levels.json", {"levels": tender_levels(m, open_rows)})
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
    """The award notices of each solicitation number a tender carries, newest award first (by award_day: a notice
    dated after the data date stands at its publication date)."""
    out: dict[str, list[dict]] = defaultdict(list)
    for r in m.conn.execute(f"SELECT * FROM x_awards WHERE solicitation IS NOT NULL "
                            f"ORDER BY {award_day(m.as_of)} DESC, reference"):
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


def attachment_name(url: str) -> str:
    """A document's name as the page shows it: the last segment of the URL's path, percent-decoded
    ("w8703-270117-rfp-demo-kit%2C-bangalore-torpedo-en.pdf" reads with its comma); the host when the path
    names none."""
    parts = urlsplit(url)
    name = unquote(parts.path.rstrip("/").rsplit("/", 1)[-1]).strip()
    return name or parts.hostname or url


def tender_attachments(versions: Sequence[sqlite3.Row]) -> list[dict]:
    """The notice's documents as {url, name}: the links of the newest version that names any (a version read
    before the column existed, or whose row left the cell blank, does not hide its predecessor's), each
    checked again with the loader's rule so no other host reaches a page, ATTACHMENTS_MAX at most."""
    for v in reversed(versions):
        urls = [u for raw in _list(v["attachments"]) or [] if (u := government_url(raw))]
        if urls:
            return [{"url": u, "name": attachment_name(u)} for u in dict.fromkeys(urls)][:ATTACHMENTS_MAX]
    return []


def description_cut(v: sqlite3.Row) -> dict[str, int] | None:
    """The cut the loader recorded for a version's descriptions (canadabuys_rows.description), as the site reads
    it: {"en": n, "fr": n} for each text cut at its last whole word within n characters, {} when both are whole.
    None for a version stored before the cut was recorded (both columns NULL): the detail then carries no
    description_cut and the site reads the text by its length, as it read every description before."""
    en, fr = v["description_en_cut"], v["description_fr_cut"]
    if en is None and fr is None:
        return None
    return {lang: int(n) for lang, n in (("en", en), ("fr", fr)) if n}


def tender_detail(m: Model, ref: str, versions: list[sqlite3.Row], codes: list[str],
                  related: dict[str, list[dict]]) -> dict:
    """A notice as it stands (its newest amendment) with its versions and its documents. The contact columns
    are never read.

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
    _places(d, v)
    if ref != v["reference"]:
        d["reference_published"] = v["reference"]
    cut = description_cut(v)
    if cut is not None:
        d["description_cut"] = cut
    documents = tender_attachments(versions)
    if documents:
        d["attachments"] = documents
    return d


def write_tender_shards(m: Model, out: Path) -> dict[str, int]:
    conn = m.conn
    solicitations = {s for (raw,) in conn.execute("SELECT DISTINCT solicitation FROM tenders") if (s := _sol(raw))}
    related = related_awards(m, solicitations)
    instruments = sosa_export.tender_instruments(conn)
    shards = m.refs["tenders"].shards()
    written = largest = 0
    over: list[str] = []
    for key in sorted(shards):
        refs = sorted(shards[key])
        versions = _versions(conn, "tenders", refs)
        codes = _codes_by_version(conn, "tender_codes", refs)
        shard = {}
        for raw in refs:
            rows = versions[raw]
            if rows:
                ref = m.refs["tenders"].url[raw]
                d = tender_detail(m, ref, rows, codes.get((raw, rows[-1]["amendment"]), []), related)
                held = instruments.get(sosa_stem(rows[-1]["solicitation"]) or "")
                if held:
                    # An RFSO or RFSA notice: the instruments it issued that are active, with their holders.
                    d["instruments"] = held
                shard[ref.lower()] = d
        size = _dump(out / "tenders" / f"{key}.json", shard)
        largest = max(largest, size)
        written += 1
        if size > TENDER_SHARD_WARN:
            over.append(f"tenders/{key}.json ({size // 1024} KB)")
    if over:
        log.warning("export: %d tender shards above %d KB: %s", len(over), TENDER_SHARD_WARN // 1024,
                    ", ".join(over[:20]))
    return {"tender_shards": written, "tender_shard_max_bytes": largest, "tender_shards_over_300kb": len(over),
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
    supplier_withheld true, with no organization, city, operating name or
    employees whatever the row holds; the contacts and the street are never read.
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
    _places(d, v)
    if withheld:
        d["supplier_withheld"] = True
    cut = description_cut(v)
    if cut is not None:
        d["description_cut"] = cut
    _value_flag(d, v["reference"] in m.flags["award" if kind == "awards" else "history"])
    if kind == "awards":
        d["end_users_en"], d["end_users_fr"] = _list(v["end_users_en"]), _list(v["end_users_fr"])
    else:
        client = _buyer_id(v["client_id"])
        c_en, c_fr = m.buyer_names(client, v["client_raw_en"], v["client_raw_fr"])
        client = m.link(client)
        d.update({"procurement_number": v["procurement_number"], "client_id": client, "client_en": c_en,
                  "client_fr": c_fr, "supplier_operating": None if withheld else v["supplier_operating"]})
        # The supplier's employees as PSPC states them, from the newest version that does; only when stated,
        # and never for a supplier withheld as a person.
        employees = None if withheld else next(
            (e for x in reversed(versions) if (e := employee_count(x["supplier_employee_count"]))), None)
        if employees:
            d["supplier_employees"] = employees
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
    """awards/recent.json, awards/erroneous.json and each year's pages, by the calendar year of the award date."""
    conn = m.conn
    # The site lists the newest by award date, so a date after the data date would head the list for good: such
    # a notice is listed apart instead (erroneous.json). A notice with no award date stays.
    recent = [row for r in conn.execute(
        "SELECT * FROM x_awards WHERE COALESCE(substr(awarded, 1, 10), '') <= ? "
        "ORDER BY published DESC, awarded DESC, reference LIMIT ?", (m.as_of, RECENT_AWARDS * 2))
        if (row := award_row(m, "awards", r))][:RECENT_AWARDS]
    _dump(out / "awards" / "recent.json", recent)
    erroneous = conn.execute("SELECT COUNT(*) FROM x_awards WHERE substr(awarded, 1, 10) > ?", (m.as_of,)).fetchone()[0]
    late = []
    for r in conn.execute("SELECT * FROM x_awards WHERE substr(awarded, 1, 10) > ? "
                          "ORDER BY awarded DESC, published DESC, reference LIMIT ?", (m.as_of, ERRONEOUS_AWARDS * 2)):
        if row := award_row(m, "awards", r):
            # The page sets the award date beside the contract's own dates, where the end date shows what was typed.
            row.update(published=r["published"], start=r["start"], end=r["end"])
            late.append(row)
    _dump(out / "awards" / "erroneous.json", late[:ERRONEOUS_AWARDS])
    years: dict[int, list[dict]] = defaultdict(list)
    for r in conn.execute("SELECT * FROM x_awards WHERE awarded IS NOT NULL ORDER BY awarded DESC, reference"):
        year = _year_of(r["awarded"])
        if year is None or not FIRST_YEAR <= year <= m.year:
            continue
        if row := award_row(m, "awards", r):
            years[year].append(row)
    pages_written = 0
    for year, rows in years.items():
        folder = out / "awards" / str(year)
        pages = _award_pages(rows)
        for n, page in enumerate(pages, start=1):
            _dump(folder / f"{n}.json", page)
        valued, unvalued = by_award_value(rows)
        value_pages = _award_pages(valued) + _award_pages(unvalued)
        for n, page in enumerate(value_pages, start=1):
            _dump(folder / "value" / f"{n}.json", page)
        _dump(folder / "index.json", {"year": year, "pages": len(pages), "rows": len(rows), "value_pages": len(value_pages),
                                      "valued_pages": len(_award_pages(valued))})
        pages_written += len(pages) + len(value_pages)
    return {"award_years": len(years), "award_pages": pages_written, "awards_erroneous": erroneous}


def _award_pages(rows: list[dict]) -> list[list[dict]]:
    return [rows[i:i + AWARD_PAGE] for i in range(0, len(rows), AWARD_PAGE)]


def _counted_value(row: dict) -> bool:
    # The site's rule for ordering by value (pages/awards.tsx orderAwards): a value in Canadian dollars or
    # in no stated currency; any other row has no value to order by.
    return row["value"] is not None and (row["currency"] or "CAD") == "CAD"


def by_award_value(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """A year's award rows (newest award date first) as the value set orders them: those with a value, largest
    first, then those without one. The sort is stable, so equal values keep the award date order and the
    reference breaks the rest.

    The two parts go to separate files (awards/<year>/value/<n>.json, the rows without a value starting a file
    of their own), so the site reads the smallest values first by reversing only the first valued_pages files,
    one file a page, and the rows without a value stay last whichever way the values run."""
    valued = sorted((r for r in rows if _counted_value(r)), key=lambda r: -r["value"])
    return valued, [r for r in rows if not _counted_value(r)]


# -- profiles -----------------------------------------------------------------------


ORG_FIELDS = ("id", "display_name", "country", "province", "city", "business_number", "first_seen", "last_seen",
              "n_awards", "n_history", "n_contracts", "n_grants", "n_lobbying", "total_awards", "total_history",
              "total_contracts", "total_grants", *organizations.NO_VALUE_FIELDS)


def _grouped(rows: Iterable[sqlite3.Row], column: str) -> dict[str, list[sqlite3.Row]]:
    out: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for r in rows:
        out[r[column]].append(r)
    return out


def _profile_tables(conn: sqlite3.Connection, rng: tuple[str, str], as_of: str) -> dict[str, dict[str, list[sqlite3.Row]]]:
    """Every row a shard's profiles show, read with one query per table over the shard's id range. Awards and
    history are newest first by award_day: a record dated after the data date (as_of) stands at its publication
    date, its award date shown as published."""
    day = award_day(as_of)
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
                   f"ORDER BY org, {day} DESC, published DESC, reference", "org"),
        "history": ("SELECT * FROM x_history WHERE org >= ? AND org < ? "
                    f"ORDER BY org, {day} DESC, published DESC, reference", "org"),
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
                   "n_no_value": r["n_no_value"] or 0, "total_positive": _money(r["total_positive"]),
                   "total_non_competitive_positive": _money(r["total_non_competitive_positive"]),
                   "n_negative": r["n_negative"] or 0}
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
    employees = profile_employees(m, t["history"].get(oid, []))
    if employees:
        p["employees"] = employees
    return p


def profile_employees(m: Model, history: Iterable[sqlite3.Row]) -> dict | None:
    """The supplier employees PSPC's contract history gives on the organization's newest record that gives
    them, with an award date and a reference the site can link: {value, awarded, reference}, or None.

    history is the profile's x_history rows, newest first as its list shows them; a record whose supplier is
    withheld names no organization, so its figure never reaches a profile.
    """
    for r in history:
        ref = m.refs["history"].get(r["reference"])
        if r["employees"] and r["awarded"] and ref is not None:
            return {"value": r["employees"], "awarded": str(r["awarded"])[:10], "reference": ref}
    return None


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


def profile_families(conn: sqlite3.Connection, m: Model) -> dict[str, dict]:
    """The "family" block of each organization in a family (families.py): the family's name and its members,
    the profile itself among them, by records (the directory's n_records: the records of every source
    counted, no value added), each with its own count and note, FAMILY_MEMBERS at most. No figure adds the
    members together. A member the export does not list is left out."""
    by_family: dict[str, list[dict]] = defaultdict(list)
    for r in conn.execute(
            "SELECT f.family, f.organization_id, f.note, o.display_name, "
            "o.n_awards + o.n_history + o.n_contracts + o.n_grants + o.n_lobbying AS n_records "
            "FROM organization_families f JOIN organizations o ON o.id = f.organization_id"):
        if r["organization_id"] in m.orgs and ORG_ID_RE.match(r["organization_id"]):
            by_family[r["family"]].append({"id": r["organization_id"], "display_name": r["display_name"],
                                           "n_records": r["n_records"] or 0, "note": r["note"]})
    out: dict[str, dict] = {}
    for family, members in by_family.items():
        members.sort(key=lambda x: (-x["n_records"], x["display_name"].casefold(), x["id"]))
        shown = members[:FAMILY_MEMBERS]
        for member in members[FAMILY_MEMBERS:]:
            # A member past the cap still names its family, with itself last in the list.
            out[member["id"]] = {"name": family, "members": shown[:FAMILY_MEMBERS - 1] + [member]}
        for member in shown:
            out[member["id"]] = {"name": family, "members": shown}
    return out


def profile_aliases(conn: sqlite3.Connection, m: Model) -> dict[str, tuple[list[dict], int]]:
    """Per live organization, the profiles merged into it (merges.py) as {"id", "name", "note", "reason"},
    for "Also appears as" on its profile, and how many there are; PROFILE_ALIASES at most are listed.

    id is the retired id, its redirect in aliases/<ab>.json (chains followed). name is the name its own
    profile showed: its records now sit under the survivor, so it is read from the survivor's spellings
    (organization_names) that normalize to the retired id, the most common first, as recompute picks a
    display name (organizations._display_names). Merges only: an id retired by a normalization change
    (reason NULL) came from rules no longer in force, so no spelling gives it. A name that reads as a
    person is left out. note is the seed's word for the tie (merges.SEED_NOTES: spelling, former, short,
    branch), null for a rule's merge; reason is the merge's rule (business_number, truncation, spelling,
    seed). The names with a note come first (a former name is what a reader most wants told), then the
    rest, each group by how many records carry the name.
    """
    resolved = resolve_aliases(conn)
    merged = {old: (reason, note) for old, reason, note in conn.execute(
        "SELECT old_id, reason, note FROM organization_aliases WHERE reason IS NOT NULL")}
    wanted: dict[str, set[str]] = defaultdict(set)
    for old, live in resolved.items():
        if old in merged and live in m.orgs and ORG_ID_RE.match(old) and ORG_ID_RE.match(live):
            wanted[live].add(old)
    best: dict[str, tuple[tuple, str, str]] = {}
    for live, raw, n in conn.execute("SELECT organization_id, raw_name, SUM(n) FROM organization_names "
                                     "GROUP BY organization_id, raw_name"):
        olds = wanted.get(live)
        if not olds or not raw:
            continue
        norm = norm_name(raw)
        old = org_id(norm) if norm else None
        if old not in olds:
            continue
        rank = (-n, 0 if raw != raw.upper() and raw != raw.lower() else 1, raw)
        if old not in best or rank < best[old][0]:
            best[old] = (rank, live, raw)
    lists: dict[str, list[tuple[tuple, dict]]] = defaultdict(list)
    for old, (rank, live, raw) in best.items():
        name = _text(raw)
        if not name or is_person_name(name):
            continue
        reason, note = merged[old]
        lists[live].append(((0 if note else 1, rank[0], name.casefold(), old),
                            {"id": old, "name": name, "note": note or None, "reason": reason}))
    return {live: ([a for _, a in sorted(items, key=lambda x: x[0])][:PROFILE_ALIASES], len(items))
            for live, items in lists.items()}


def public_accounts_blocks(conn: sqlite3.Connection, what: str, build: Callable[[], dict[str, dict]]) -> dict[str, dict]:
    """A Public Accounts block builder (sources/public_accounts.py), guarded: a fault writes the profiles or the
    buyer files without the block, logs a notice, and never fails the export."""
    try:
        return build()
    except Exception as exc:
        log.exception("export: the Public Accounts blocks of the %s failed", what)
        log_run(conn, "export_public_accounts", detail=f"{what}: {type(exc).__name__}: {exc}"[:900],
                notice=f"the Public Accounts payments were left out of the {what} tonight ({type(exc).__name__}: {exc})"[:900])
        return {}


def indigenous_target_blocks(conn: sqlite3.Connection, build: Callable[[], dict[str, dict]]) -> dict[str, dict]:
    """The Indigenous procurement target's block builder (sources/indigenous_target.py), guarded as the Public
    Accounts' are: a fault writes the buyer files without the block, logs a notice, and never fails the export."""
    try:
        return build()
    except Exception as exc:
        log.exception("export: the Indigenous procurement target blocks failed")
        log_run(conn, "export_indigenous_target", detail=f"buyer files: {type(exc).__name__}: {exc}"[:900],
                notice=f"the Indigenous procurement target was left out of the buyer files tonight ({type(exc).__name__}: {exc})"[:900])
        return {}


def write_profiles(conn: sqlite3.Connection, out: Path, m: Model) -> dict[str, int]:
    """profiles/<abc>.json: every organization's profile, one shard per three hex digits of its id."""
    keys = sorted({shard_key(oid) for oid in m.orgs})
    held = sosa_export.organization_parts(conn)
    payments = public_accounts_blocks(conn, "profiles", lambda: public_accounts.profile_blocks(
        conn, orgs=m.orgs, listed=m.listed, buyer_names={bid: (b["name_en"], b["name_fr"]) for bid, b in m.buyers.items()}))
    held_segments = profile_matching.held_instruments(conn)
    family = profile_families(conn, m)
    also = profile_aliases(conn, m)
    written = largest_bytes = 0
    over: list[str] = []
    for key in keys:
        rng = _id_range(key)
        orgs = conn.execute(f"SELECT {', '.join(ORG_FIELDS)} FROM organizations WHERE id >= ? AND id < ? ORDER BY id",
                            rng).fetchall()
        tables = _profile_tables(conn, rng, m.as_of)
        non_cad: dict[str, dict[str, int]] = defaultdict(dict)
        for source, temp in (("awards", "x_awards"), ("history", "x_history")):
            for oid, n in conn.execute(
                    f"SELECT org, COUNT(*) FROM {temp} WHERE org >= ? AND org < ? "
                    "AND UPPER(TRIM(COALESCE(currency, ''))) NOT IN ('', 'CAD') GROUP BY org", rng):
                non_cad[oid][source] = n
        checks = _value_checks(conn, rng)
        shard = {o["id"]: _profile_extra(m, profile(m, o, tables, non_cad.get(o["id"], {})), checks.get(o["id"], {}))
                 for o in orgs}
        for oid, p in shard.items():
            if oid in held:
                p["instruments"] = held[oid]
            # The same rows the lists above read, every one of them, not only the PROFILE_ROWS listed.
            block = profile_matching.matching_block(
                tables["awards"].get(oid, []), tables["history"].get(oid, []), tables["contracts"].get(oid, []),
                held_segments.get(oid), as_of=m.as_of, segments=m.segments, link=m.link)
            if block:
                p["matching"] = block
            if oid in family:
                p["family"] = family[oid]
            if oid in also:
                p["aliases"], total = also[oid]
                if total > len(p["aliases"]):
                    p["aliases_total_rows"] = total
            if oid in payments:
                p["public_accounts"] = payments[oid]
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
    """aliases/<ab>.json: retired organization id -> live id, sharded on the retired id's characters 5 and 6.

    Why: a profile link shared before a normalization change names an id that
    no longer exists, and the site looks a missing id up here (in the file
    named like the profile shard it just missed in) to send the visitor on.
    Retired ids never go in the sitemap.
    """
    shards: dict[str, dict[str, str]] = defaultdict(dict)
    for old, new in resolve_aliases(conn).items():
        if ORG_ID_RE.match(old) and ORG_ID_RE.match(new):
            shards[old[4:6]][old] = new
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
                "n_contracts_no_value", "n_grants_no_value", "n_lobbying")

# The spellings the record sources carry for a buyer, with how many record rows carry each: the
# contracting entity of a tender or award notice, the client department of a PSPC history record.
_BUYER_SPELLINGS_SQL = (
    "SELECT b, raw, COUNT(*) AS n FROM ("
    "SELECT buyer_id AS b, buyer_raw_en AS raw FROM tenders WHERE buyer_id IS NOT NULL "
    "UNION ALL SELECT buyer_id, buyer_raw_fr FROM tenders WHERE buyer_id IS NOT NULL "
    "UNION ALL SELECT buyer_id, buyer_raw_en FROM awards WHERE buyer_id IS NOT NULL "
    "UNION ALL SELECT buyer_id, buyer_raw_fr FROM awards WHERE buyer_id IS NOT NULL "
    "UNION ALL SELECT client_id, client_raw_en FROM contract_history WHERE client_id IS NOT NULL "
    "UNION ALL SELECT client_id, client_raw_fr FROM contract_history WHERE client_id IS NOT NULL"
    ") WHERE raw IS NOT NULL AND raw != '' GROUP BY b, raw ORDER BY b, n DESC, raw"
)


def buyer_aliases_of(m: Model, listed: Collection[str]) -> dict[str, list[dict]]:
    """The other names each listed buyer appears under, as {"name", "note"}, for "Also appears as" on its page.

    First the alias seed's names for it (awardwatch_pipeline/data/buyer_aliases.csv, in the file's order;
    note "former" on a former name, else the row's note), then the names of the buyers merged into it
    (buyer_aliases), then the spellings its records carry most. A source spelling is shown only when
    buyers.shown_spelling allows it (nothing that names or locates a person) and when it is not the
    buyer's own name or another name already listed by key (buyers.name_key: "Department of National
    Defence (DND)" is "National Defence"). At most BUYER_ALIASES a buyer.
    """
    out: dict[str, list[dict]] = defaultdict(list)
    keys: dict[str, set[str]] = {}

    def start(bid: str) -> set[str] | None:
        if bid not in listed or bid not in m.buyers:
            return None
        if bid not in keys:
            b = m.buyers[bid]
            keys[bid] = {buyer_rules.name_key(x) for x in (b["name_en"], b["name_fr"], b["acronym_en"], b["acronym_fr"]) if x}
        return keys[bid]

    def add(bid: str, name: object, note: str | None, *, curated: bool) -> None:
        seen = start(bid)
        text = _text(name)
        if seen is None or not text or len(out[bid]) >= BUYER_ALIASES:
            return
        b = m.buyers[bid]
        if text.casefold() in {(x or "").casefold() for x in (b["name_en"], b["name_fr"], b["acronym_en"], b["acronym_fr"])}:
            return
        key = buyer_rules.name_key(buyer_rules._PARENS_RE.sub(" ", text)) or buyer_rules.name_key(text)
        if not curated and key in seen:
            return
        if any(a["name"].casefold() == text.casefold() for a in out[bid]):
            return
        seen.add(key)
        out[bid].append({"name": text, "note": note})

    notes = {r["alias"]: r["note"] for r in buyer_rules.read_aliases()}
    applied = dict(m.conn.execute("SELECT raw_name, buyer_id FROM buyer_names WHERE source = 'alias'").fetchall())
    for alias, note in notes.items():
        if alias in applied:
            add(applied[alias], alias, note, curated=True)
    for r in m.conn.execute("SELECT new_id, name_en, name_fr FROM buyer_aliases ORDER BY updated_at, old_id"):
        for name in (r["name_en"], r["name_fr"]):
            add(r["new_id"], name, None, curated=True)
    for bid, raw, _n in m.conn.execute(_BUYER_SPELLINGS_SQL):
        if bid in listed and len(out[bid]) < BUYER_ALIASES and (shown := buyer_rules.shown_spelling(raw)):
            add(bid, shown, None, curated=False)
    return dict(out)


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
    also = buyer_aliases_of(m, listed)
    holders = sosa_export.buyer_holders(conn)
    payments = public_accounts_blocks(conn, "buyer files", lambda: public_accounts.buyer_blocks(conn, orgs=m.orgs, listed=listed))
    targets = indigenous_target_blocks(conn, lambda: indigenous_target.buyer_blocks(conn, listed=listed))
    for s in summaries:
        bid = s["id"]
        b = m.buyers[bid]
        # As awards/recent.json: the page lists them by award date, so one dated after the data date stays out.
        recent = [row for r in conn.execute(
            "SELECT * FROM x_awards WHERE buyer_id = ? AND COALESCE(substr(awarded, 1, 10), '') <= ? "
            "ORDER BY published DESC, awarded DESC, reference LIMIT ?",
            (bid, m.as_of, BUYER_AWARDS * 2)) if (row := award_row(m, "awards", r))][:BUYER_AWARDS]
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
            "aliases": also.get(bid, []),
            **({"holders": holders[bid]} if bid in holders else {}),
            **({"public_accounts": payments[bid]} if bid in payments else {}),
            **({"indigenous_target": targets[bid]} if bid in targets else {}),
        })
    retired = {old: new for old, new in conn.execute("SELECT old_id, new_id FROM buyer_aliases ORDER BY old_id")
               if new in listed and old not in listed and _buyer_id(old)}
    _dump(out / "buyers" / "aliases.json", {"aliases": retired})
    return {"buyers": len(summaries), "buyer_aliases": len(retired)}


def write_categories(m: Model, out: Path, open_rows: list[dict]) -> dict[str, int]:
    """categories/index.json and one file per UNSPSC segment: its open notices, its award notices by year
    and its top organizations by award notice value (a notice with codes in two segments counts in each)."""
    open_by: dict[str, list[dict]] = defaultdict(list)
    for r in open_rows:
        for seg in r["segments"]:
            open_by[seg].append(list_fields(r))
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
    holders = sosa_export.segment_holders(m.conn)
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
            **({"holders": holders[code]} if code in holders else {}),
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


# -- standing offers and supply arrangements ----------------------------------------------


def write_instruments(m: Model, out: Path) -> dict[str, int]:
    """instruments/index.json: every instrument with an active holder (sosa_export.index_doc)."""
    doc = sosa_export.index_doc(m.conn, m.as_of)
    _dump(out / "instruments" / "index.json", doc)
    return {"instruments": len(doc["rows"])}


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
    if "instruments" not in skip:
        entries += sosa_export.sitemap_entries(conn, dated)
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
                  base_url: str | None = None, csv_dir: Path | None = None,
                  csv_rows: dict[str, int] | None = None) -> dict[str, int]:
    """Write the static tree. csv_dir is the CSV export's folder, whose files stats.json lists with their
    sizes (data/out/csv by default when out_dir is the default too); csv_rows the rows export_csv counted."""
    final = out_dir or (config.OUT_DIR / "static")
    if csv_dir is None and out_dir is None:
        csv_dir = config.OUT_DIR / "csv"
    # Written beside the final folder and moved into place only when every
    # file is written, so a failure part way leaves the previous export (or
    # none at all) rather than a half-written tree the deploy would publish.
    out = final.with_name(final.name + ".partial")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    try:
        counts = _write_static(conn, out, today or datetime.now(timezone.utc).date(), base_url or config.SITE_URL,
                               download_files(csv_dir, csv_rows))
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


def _write_static(conn: sqlite3.Connection, out: Path, today: date, base_url: str,
                  downloads: list[dict] | None = None) -> dict[str, int]:
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
        ("instruments", lambda: write_instruments(m, out)),
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
        # The notices awards/erroneous.json lists, all of them (the file holds ERRONEOUS_AWARDS at most).
        "awards_erroneous": counts["awards_erroneous"],
        "history": conn.execute("SELECT COUNT(*) FROM x_history").fetchone()[0],
        "contracts": conn.execute("SELECT COUNT(*) FROM contracts").fetchone()[0],
        "grants": conn.execute("SELECT COUNT(*) FROM x_grants").fetchone()[0],
        "lobbying": conn.execute("SELECT COUNT(*) FROM lobbying_communications").fetchone()[0],
    }
    write_stats(m, out, counts=stats_counts, open_rows=open_rows, new_today=new_today,
                top_year=top_organizations_year(m, totals), downloads=downloads)
    counts.update(write_sitemaps(sitemap_entries(m, failed), out, base_url))
    counts["organizations"] = len(m.orgs)
    return counts
