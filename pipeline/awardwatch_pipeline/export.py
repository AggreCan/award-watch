"""CSV downloads for the Data page, with a SHA256SUMS file to check them by.

Files (under data/out/csv; the workflow uploads them to R2 under downloads/,
and the site serves only these names):

  open-tenders.csv        every tender notice open on the data date, at its newest amendment (a notice
                          the source still lists as open after its closing day is left out)
  awards-<year>.csv       every award notice version whose award date (else
                          publication date) falls in the year, from FIRST_YEAR["awards"] (2012)
  awards-before-2012.csv  the award notice versions dated before it: a handful of rows whose dates
                          are typing errors in the source, in one file rather than a file a year
  awards-after-<year>.csv the versions dated after the data date's year, typing errors too ("2040"),
                          in one file named for that year
  history-<year>.csv      every contract history version, by the same rule, from 2009
  history-before-2009.csv, history-after-<year>.csv   the same for the contract history
  contracts-<year>.csv    every published contract row (proactive publication) whose contract date falls
                          in the year, from 2004, with contracts-before-2004.csv and contracts-after-<year>.csv
  grants-<year>.csv       every grant and contribution version whose agreement start falls in the year,
                          from 2005, with grants-before-2005.csv and grants-after-<year>.csv
  <source>-undated.csv    the rows of a source whose date gives no year (none, or text that is not a date),
                          so every row is in one file; this and the before and after files are written
                          only when such a row exists. A yearly file that would pass CSV_PART_BYTES goes
                          on in <name>-2.csv, -3 and on: the nightly puts each file in R2 in one upload,
                          which Wrangler refuses above 300 MiB
  organizations.csv       one row per organization: names, main place, counters and totals by source,
                          and beside each total the count of records whose source published no value
  buyers.csv              one row per buyer with a record in a column the buyers list shows (listed_buyer_ids):
                          names, acronyms, kind, counters and totals by source, with the same no-value counts,
                          and the lobbying reports that name it
  expiring-12m.csv        the expiring-contracts radar: every contract ending within 365 days, listed
                          once across the three sources (expiring.py), soonest end first, with the
                          client department and the value flag
  expiring-3m.csv         the same columns for the rows ending within the 3-month window of the data
                          date (expiring.WINDOWS), as the site's 3-month list counts them: the file the
                          site keeps free once the 6- and 12-month windows are part of its paid plan
  expiring-6m.csv         the same columns for the rows ending within the 6-month window, as the site's
                          6-month list counts them; part of the paid plan with the 12-month file, by the
                          same gate (site/src/index.tsx)
  organization-aliases.csv  the alias map: every retired organization id and the live id that holds its
                          records now (export_static.resolve_aliases, chains followed), with the reason
                          (business_number, truncation, spelling, seed, or normalization for a change to
                          the name rules), the seed's note (spelling, former, short, branch; blank for the
                          rules), and since (the date the mapping began). Ids only and no record data,
                          so the file is free and nothing a paid plan holds is in it. A reader of an older
                          download maps its organization_id to the live one with it
  SHA256SUMS              sha256sum's format: "<hex>  <file>" per line, sorted by file name; every file
                          in it is one the Data page offers

Every CSV opens with a UTF-8 byte-order mark, so a spreadsheet reads the
French names as written, and a list field (provinces, segments, end users) is
its values joined by "; " ("SK; MB"), never a JSON array. provinces are the
ones a record's regions of delivery state; provinces_derived the ones derived
from another field, which provinces_from names (places.py). A value the source
did not publish is an empty cell, never 0. SHA256SUMS is computed on the bytes
written, mark included. The award, history and published contract files
carry value_flag ("check" when value_checks.py flagged the contract's value).
Closing times in open-tenders.csv are as CanadaBuys publishes them: Eastern
time, with no zone written.

What never goes in a file: the contacts on tender and award notices, supplier
street addresses and postal codes (the published contracts' vendor_postal and
the grants' postal_code included), the published contracts' buyer_name (a
public servant), any name the loaders withheld as a private individual
(supplier_raw is NULL on those rows and supplier_withheld says so; vendor and
legal_name likewise in the contracts and grants files), and a buyer spelling
that names or locates a person (buyers.public_spelling: the buyer_raw_en and
client_raw_en cells are blank on those rows). Rows are
sorted and every value is written the same way each night, so an unchanged
year keeps its bytes.

The downloads are the records as published, one row per version: the totals
the site shows follow CLAUDE.md "Counting money" and add one version per
contract, so a reader adding up these files would count a contract once per
amendment. A published contract's contract_value is its total with the
amendment; the site adds each row's own value (amendment_value on an
amendment, else original_value, else contract_value), and a grant's newest
amendment alone.
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, TextIO

from . import config, expiring
from .db import log_run
from .normalize import employee_count, tender_status_on
from .sources.buyers import public_spelling

log = logging.getLogger(__name__)

SUMS = "SHA256SUMS"

# -- contact details inside the publishers' own text ------------------------------
#
# Descriptions and titles are the publisher's prose, and some carry a
# contracting officer's email address or telephone number ("send questions to
# the inbox X@... or call 613-..."). Contacts are never exported (CLAUDE.md rule
# 3), so every free-text field the exports write goes through scrub: an email
# address and a North American telephone or fax number become the placeholder
# in the field's language.
#
# A number counts as a telephone number only when it is written as one: three,
# three and four digits with a separator between the groups (a space, a dot or
# a hyphen, or the area code in brackets), with or without a leading 1 or +1
# and an extension. Prose is full of digit runs that are not telephone numbers
# (solicitation numbers joined to letters such as W8484-199273 or
# WS5176912673, numbered companies, coordinates, times), so a run of digits on
# its own is left alone. The one exception is a run of ten digits (or a 1 and
# ten) straight after a telephone or fax label ("Fax: 6135550199"), which is a
# number written as a telephone number by its label.

REMOVED = {"en": "[contact removed]", "fr": "[coordonnées retirées]"}
# The fields whose text is the publisher's prose; names and code lists are not.
FREE_TEXT_KEY = re.compile(r"^(title|description|excerpt|comments|program|selection|limited_reason)_(en|fr)$")
# An address may carry a space on either side of the @ in prose; its domain has a dot.
EMAIL_RE = re.compile(r"[\w.+%'-]+\s?@\s?[\w-]+(?:\.[\w-]+)+")
# Not joined to a letter, a digit, a "+", a hyphen, or a decimal ("49.613 555 0100" is a coordinate).
_PHONE_START = r"(?<![\w+\-])(?<!\d\.)"
# Not followed by another digit, or by a decimal point, comma or hyphen and a digit
# ("400-013-4490-41" is a part number). A letter may follow: prose pasted from a
# web page runs a number into the next label ("(306) 659-9300Courriel").
_PHONE_END = r"(?!\d)(?![.,\-]\d)"
_EXTENSION = r"(?:\s*,?\s*(?:ext\.?|extension|x|poste|p\.)\s*\d{1,6})?"
PHONE_RE = re.compile(
    _PHONE_START
    + r"(?:\+\s?1[\s.\-]?|1[\s.\-])?"           # +1 or 1, then a separator
    + r"(?:\(\s?\d{3}\s?\)\s?|\d{3}[ .\-])"         # the area code: in brackets, or followed by a separator
    + r"\d{3}[ .\-]\d{4}"                          # the exchange, a separator, the line
    + _EXTENSION + _PHONE_END,
    re.IGNORECASE,
)
# A telephone or fax label, then a number written without separators.
LABELLED_PHONE_RE = re.compile(
    r"(?<!\w)(?P<label>(?:tel|t[eé]l|phone|t[eé]l[eé]phone|telephone|fax|t[eé]l[eé]copieur|t[eé]l[eé]c|cell|mobile)"
    r"\.?\s*(?:[:#.]\s*)?)(?:\+?1)?\d{10}" + _EXTENSION + r"(?!\w)",
    re.IGNORECASE,
)
# An @ the address pattern did not take (a broken address, "someone@ministry")
# still goes; one standing alone between spaces ("January 23 @ 2:00 PM") is not an address.
STRAY_AT_RE = re.compile(r"(?<=\S)@|@(?=\S)")


def scrub(text: object, lang: str = "en") -> object:
    """text with every email address and telephone or fax number replaced; anything else as given."""
    if not isinstance(text, str) or not text:
        return text
    mark = REMOVED["fr" if lang == "fr" else "en"]
    out = PHONE_RE.sub(mark, EMAIL_RE.sub(mark, text))
    out = LABELLED_PHONE_RE.sub(lambda m: m.group("label") + mark, out)
    return STRAY_AT_RE.sub(mark, out)


def scrub_doc(obj: object) -> object:
    """Scrub every free-text field of a JSON-shaped value in place (lists and objects at any depth); returns it."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            if isinstance(value, str):
                m = FREE_TEXT_KEY.match(key) if isinstance(key, str) else None
                if m:
                    obj[key] = scrub(value, m.group(2))
            elif isinstance(value, (dict, list)):
                scrub_doc(value)
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, (dict, list)):
                scrub_doc(item)
    return obj


def register_functions(conn: sqlite3.Connection) -> None:
    """The SQL functions the export queries call: tender_status_on(status, closing, as_of), a notice's
    status on the data date (normalize.tender_status_on), so the open list is one rule in every file; and
    employee_count(raw), a history record's supplier employees as the export writes them
    (normalize.employee_count)."""
    conn.create_function("tender_status_on", 3, tender_status_on, deterministic=True)
    conn.create_function("employee_count", 1, employee_count, deterministic=True)


YEAR_RE = re.compile(r"^(awards|history|contracts|grants)-(?:\d{4}|before-\d{4}|after-\d{4}|undated)(?:-[2-9])?\.csv$")
# The first year with a file of its own; earlier dates share one file. On the
# notices those are typing errors in the source. Published contracts start in
# 2004 and grants in 2005, the years their proactive publication began; an
# earlier date there is a contract or an agreement reported later.
FIRST_YEAR = {"awards": 2012, "history": 2009, "contracts": 2004, "grants": 2005}
# A yearly file stops at this size and goes on in <name>-2.csv: the nightly
# puts each file in R2 in one upload, which Wrangler refuses above 300 MiB
# (the margin nightly.PART_MIB keeps too). A year of grants, the widest rows,
# is expected well under it; the split keeps a busy year downloadable anyway.
CSV_PART_BYTES = 250 * 1024 * 1024
# Rows between two looks at a part's size, so a part ends within a few MiB of the cap.
PART_CHECK_ROWS = 1000
FIXED_FILES = ("open-tenders.csv", "organizations.csv", "buyers.csv", "expiring-3m.csv", "expiring-6m.csv",
               "expiring-12m.csv")

OPEN_TENDERS = """
    SELECT t.reference, t.amendment, t.solicitation, t.title_en, t.title_fr, t.published, t.closing, t.amended,
           t.status, t.category, t.notice_type_en, t.method_en, t.selection_en, t.limited_reason_en,
           t.trade_agreements_en, t.regions_delivery_en, t.provinces, t.provinces_derived, t.provinces_from,
           t.buyer_id, b.name_en AS buyer_name_en,
           b.name_fr AS buyer_name_fr, t.buyer_raw_en, t.end_users_en,
           (SELECT group_concat(c.unspsc, ' ') FROM tender_codes c WHERE c.reference = t.reference
              AND c.amendment = t.amendment) AS unspsc,
           t.gsin, t.description_en, t.description_fr, t.source_file, t.first_seen, t.last_seen
    FROM tenders t LEFT JOIN buyers b ON b.id = t.buyer_id
    WHERE tender_status_on(t.status, t.closing, :as_of) = 'open'
      AND t.amendment = (SELECT MAX(y.amendment) FROM tenders y WHERE y.reference = t.reference)
    ORDER BY t.closing, t.reference"""

_CONTRACT_COLUMNS = """
    a.reference, a.amendment, a.solicitation, a.contract_number, a.title_en, a.title_fr, a.published, a.awarded,
    a.amended, a.start, a.end, a.amount, a.total_value, a.currency, a.status, a.instrument_type_en,
    a.amendment_type_en, a.method_en, a.competitive, a.limited_reason_en, a.buyer_id,
    b.name_en AS buyer_name_en, a.buyer_raw_en, {extra}
    a.organization_id, o.display_name AS organization, a.supplier_raw AS supplier, a.supplier_withheld,
    a.supplier_city, a.supplier_province, a.supplier_country,
    (SELECT group_concat(c.unspsc, ' ') FROM {codes} c WHERE c.reference = a.reference
       AND c.amendment = a.amendment) AS unspsc,
    a.gsin, a.provinces, a.provinces_derived, a.provinces_from, a.source_file, a.first_seen, a.last_seen"""

_FLAG = "(SELECT 'check' FROM value_flags f WHERE f.kind = '{kind}' AND f.key = a.reference) AS value_flag,"
# The yearly files' queries without the year test and the order, which _yearly_query adds.
AWARDS = (
    "SELECT " + _CONTRACT_COLUMNS.format(extra="a.end_users_en, " + _FLAG.format(kind="award"), codes="award_codes") +
    " FROM awards a LEFT JOIN buyers b ON b.id = a.buyer_id LEFT JOIN organizations o ON o.id = a.organization_id"
)
HISTORY = (
    "SELECT " + _CONTRACT_COLUMNS.format(
        extra="a.procurement_number, a.client_id, k.name_en AS client_name_en, a.client_raw_en, "
              + _FLAG.format(kind="history"),
        codes="history_codes") +
    " FROM contract_history a LEFT JOIN buyers b ON b.id = a.buyer_id LEFT JOIN buyers k ON k.id = a.client_id"
    " LEFT JOIN organizations o ON o.id = a.organization_id"
)
# Published contracts, each row as the department reported it (an amendment is
# a row of its own), with the value check the totals follow.
CONTRACTS = """
    SELECT c.owner_org, c.reference, c.procurement_id, c.reporting_period, c.contract_date, c.period_start,
           c.delivery_date, c.value AS contract_value, c.original_value, c.amendment_value, c.instrument_type,
           c.solicitation_procedure, c.competitive, c.limited_tendering_reason, c.trade_agreement,
           c.trade_agreement_exceptions, c.agreement_type, c.commodity_type, c.commodity_code, c.economic_object,
           c.description_en, c.description_fr, c.comments_en, c.comments_fr, c.land_claims, c.indigenous_business,
           c.indigenous_business_excluding_psib, c.intellectual_property, c.potential_commercial_exploitation,
           c.former_public_servant, c.standing_offer_number, c.ministers_office, c.number_of_bids,
           c.article_6_exceptions, c.award_criteria, c.socioeconomic_indicator, c.contracting_entity, c.buyer_id,
           b.name_en AS buyer_name_en, c.organization_id, o.display_name AS organization, c.vendor_raw AS vendor,
           c.vendor_withheld, c.vendor_country,
           (SELECT 'check' FROM value_flags f WHERE f.kind = 'contract'
              AND f.key = c.owner_org || ':' || c.procurement_id) AS value_flag
    FROM contracts c LEFT JOIN buyers b ON b.id = c.buyer_id LEFT JOIN organizations o ON o.id = c.organization_id"""
# Grants and contributions, one row per agreement version (the highest
# amendment carries the value the totals add).
GRANTS = """
    SELECT g.owner_org, g.reference, g.amendment, g.amendment_date, g.agreement_number, g.agreement_type,
           g.recipient_type, g.start, g."end", g.value, g.fx_type, g.fx_value, g.program_en, g.program_fr,
           g.title_en, g.title_fr, g.description_en, g.description_fr, g.naics, g.buyer_id,
           b.name_en AS buyer_name_en, g.organization_id, o.display_name AS organization, g.legal_name,
           g.operating_name, g.research_organization, g.business_number, g.recipient_withheld, g.country,
           g.province, g.city, g.riding_number, g.riding_en, g.riding_fr
    FROM grants g LEFT JOIN buyers b ON b.id = g.buyer_id LEFT JOIN organizations o ON o.id = g.organization_id"""
# Each source with yearly files: its table under the alias its query reads it
# by, the date whose calendar year names the file, the query, the row order.
YEARLY = {
    "awards": ("awards a", "COALESCE(a.awarded, a.published)", AWARDS, "a.reference, a.amendment"),
    "history": ("contract_history a", "COALESCE(a.awarded, a.published)", HISTORY, "a.reference, a.amendment"),
    "contracts": ("contracts c", "c.contract_date", CONTRACTS, "c.owner_org, c.reference"),
    "grants": ("grants g", "g.start", GRANTS, "g.owner_org, g.reference, g.amendment"),
}
ORGANIZATIONS = """
    SELECT id, display_name, country, province, city, business_number, first_seen, last_seen, n_awards,
           total_awards, n_awards_no_value, n_history, total_history, n_history_no_value, n_contracts, total_contracts,
           n_contracts_no_value, n_grants, total_grants, n_grants_no_value, n_lobbying
    FROM organizations ORDER BY norm_name, id"""
_EXPIRING_SELECT = """
    SELECT kind, reference, title_en, title_fr, organization_id, organization, supplier_withheld, buyer_id, buyer_en,
           buyer_fr, start, end, days_left, value, currency, competitive, method_en, instrument_en, n_amendments,
           value_growth, tender_reference, segments, provinces, provinces_derived, provinces_from, client_buyer_id,
           client_buyer_name, client_buyer_name_fr, value_flag
    FROM expiring_contracts"""
EXPIRING = _EXPIRING_SELECT + " ORDER BY end, source_key"
# The 3- and 6-month files: the rows that end on or after the data date and
# within the window of it, the rule export_static.write_expiring applies to the
# site's 3- and 6-month lists (days_left counted again from the data date). The
# 3-month file stays free when the longer windows are part of the site's paid
# plan; the 6-month file is part of it, as the 12-month file is.
EXPIRING_3M_DAYS = dict(expiring.WINDOWS)["3m"]
EXPIRING_6M_DAYS = dict(expiring.WINDOWS)["6m"]
EXPIRING_WINDOW = (_EXPIRING_SELECT + " WHERE substr(end, 1, 10) BETWEEN :as_of AND date(:as_of, :span)"
                   " ORDER BY end, source_key")
# The files cut to a window, by file name, with the window's days.
EXPIRING_WINDOW_FILES = {"expiring-3m.csv": EXPIRING_3M_DAYS, "expiring-6m.csv": EXPIRING_6M_DAYS}
# A buyer is listed (buyers.csv, and buyers/, the rankings and stats.json in the
# static export) when it has a record in a column the buyers list shows: an
# open tender notice on the data date, an award notice, a contract history
# record, a published contract or a grant. One whose only records are tender
# notices that have closed shows zero in every column and is left out. An
# institution only the lobbying registry names (kind 'institution',
# sources/buyers.refresh_kinds) is listed apart while a report names it.
LISTED_BUYER = """
    (b.n_awards > 0 OR b.n_history > 0 OR b.n_contracts > 0 OR b.n_grants > 0
     OR (b.kind = 'institution' AND b.n_lobbying > 0)
     OR EXISTS (SELECT 1 FROM tenders t WHERE t.buyer_id = b.id
                AND tender_status_on(t.status, t.closing, :as_of) = 'open'
                AND t.amendment = (SELECT MAX(y.amendment) FROM tenders y WHERE y.reference = t.reference)))"""
BUYERS = f"""
    SELECT id, name_en, name_fr, acronym_en, acronym_fr, ckan_org, department_number, kind, n_tenders, n_awards,
           total_awards, n_awards_no_value, n_history, n_contracts, total_contracts, n_contracts_no_value, n_grants,
           total_grants, n_grants_no_value, n_lobbying
    FROM buyers b WHERE {LISTED_BUYER} ORDER BY id"""
# The raw spellings of a buyer the CSVs print: blank when they name or locate a person.
RAW_BUYER_COLUMNS = frozenset({"buyer_raw_en", "client_raw_en"})


def listed_buyer_ids(conn: sqlite3.Connection, as_of: str) -> set[str]:
    """The buyers the exports list on the data date (LISTED_BUYER)."""
    register_functions(conn)
    return {r[0] for r in conn.execute(f"SELECT b.id FROM buyers b WHERE {LISTED_BUYER}", {"as_of": as_of})}


def _cell(value: object) -> object:
    # Floats in a fixed form, so a value read back the same writes the same bytes.
    if isinstance(value, float):
        return f"{value:.2f}"
    return "" if value is None else _flat(value)


def _flat(value: object) -> object:
    """A list column (stored as a JSON array of strings) as its values joined by "; ": '["SK", "MB"]' -> 'SK; MB'.

    A spreadsheet shows the array's brackets and quotes as they are. Only a
    JSON array of strings is read so; any other text, a title that opens with
    a bracket included, is written as it is.
    """
    if not (isinstance(value, str) and value.startswith("[") and value.endswith("]")):
        return value
    try:
        items = json.loads(value)
    except ValueError:
        return value
    if not isinstance(items, list) or not all(isinstance(i, str) for i in items):
        return value
    return "; ".join(i for i in items if i.strip())


class _Counted:
    """What the csv module writes to: passes the text on and counts its bytes in UTF-8."""

    def __init__(self, fh: TextIO) -> None:
        self.fh = fh
        self.bytes = 0

    def write(self, text: str) -> int:
        self.bytes += len(text.encode("utf-8"))
        return self.fh.write(text)


def _write_parts(path: Path, cur: sqlite3.Cursor, cap: int | None = None) -> dict[str, int]:
    """One CSV through a partial file, renamed when complete, so a failure never leaves a truncated file for the
    upload. With cap, a file that has reached cap bytes ends at the next check and the rows go on in
    <name>-2.csv (then -3, up to -9), each part with the header and the byte-order mark. Returns the rows
    under the header of each file written, by file name."""
    headers = [d[0] for d in cur.description]
    langs = [(m.group(2) if (m := FREE_TEXT_KEY.match(h)) else None) for h in headers]
    raw = [h in RAW_BUYER_COLUMNS for h in headers]
    counts: dict[str, int] = {}
    target, n = path, 0

    def partial(name: Path) -> Path:
        return name.with_name(name.name + ".partial")

    def start(name: Path) -> tuple[TextIO, _Counted, Any]:
        # utf-8-sig: the byte-order mark makes a spreadsheet read the file as UTF-8.
        fh = partial(name).open("w", newline="", encoding="utf-8-sig")
        sized = _Counted(fh)
        writer = csv.writer(sized, lineterminator="\n")
        writer.writerow(headers)
        return fh, sized, writer

    fh, sized, writer = start(target)
    try:
        for row in cur:
            if cap is not None and n and n % PART_CHECK_ROWS == 0 and sized.bytes >= cap:
                fh.close()
                partial(target).replace(target)
                counts[target.name] = n
                if len(counts) >= 9:
                    raise ValueError(f"{path.name}: more than 9 parts of {cap} bytes")
                target, n = path.with_name(f"{path.stem}-{len(counts) + 1}{path.suffix}"), 0
                fh, sized, writer = start(target)
            writer.writerow([_cell(scrub(v, lang) if lang else public_spelling(v) if is_raw else v)
                             for v, lang, is_raw in zip(row, langs, raw)])
            n += 1
    finally:
        fh.close()
    partial(target).replace(target)
    counts[target.name] = n
    return counts


def _write(path: Path, cur: sqlite3.Cursor) -> int:
    """One CSV through a partial file, with no size cap; returns its rows."""
    return _write_parts(path, cur)[path.name]


def _dated(date_sql: str) -> str:
    """The test a row's date passes when it opens with a four-digit year: such a row goes in the file of that
    year, or the before or after file; any other row (no date, or text that is not one) in the undated file."""
    return f"substr({date_sql}, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'"


def _years(conn: sqlite3.Connection, table: str, date_sql: str) -> list[str]:
    return [y for (y,) in conn.execute(
        f"SELECT DISTINCT substr({date_sql}, 1, 4) FROM {table} WHERE {_dated(date_sql)} ORDER BY 1")]


def _undated(conn: sqlite3.Connection, table: str, date_sql: str) -> bool:
    return conn.execute(f"SELECT 1 FROM {table} WHERE {date_sql} IS NULL OR NOT {_dated(date_sql)} LIMIT 1"
                        ).fetchone() is not None


def _yearly_query(prefix: str, kind: str = "year") -> str:
    """A yearly file's query, in the file's row order. year: the dates from the first argument up to the second
    (two year strings, so the date's index serves the range; a date opening with "2024" is at or after "2024"
    and before "2025", and no other text is). before and after: the dated rows before or from the argument,
    by date first, as they span several years. undated: the rest, which take no argument."""
    _, date_sql, select, order = YEARLY[prefix]
    if kind == "year":
        return f"{select} WHERE {date_sql} >= ? AND {date_sql} < ? ORDER BY {order}"
    if kind == "undated":
        return f"{select} WHERE {date_sql} IS NULL OR NOT {_dated(date_sql)} ORDER BY {order}"
    op = {"before": "<", "after": ">="}[kind]
    return f"{select} WHERE {date_sql} {op} ? AND {_dated(date_sql)} ORDER BY substr({date_sql}, 1, 10), {order}"


def _yearly_files(conn: sqlite3.Connection, prefix: str, last: int | None = None) -> list[tuple[str, str, tuple]]:
    """(file name, query, arguments) for each yearly file of a source: one per year from FIRST_YEAR to last (the
    data date's year), the years before it together in <prefix>-before-<FIRST_YEAR>.csv, the years after last
    together in <prefix>-after-<last>.csv, and the rows whose date gives no year in <prefix>-undated.csv; the
    last three only when such a row exists. Every row of the source is in exactly one file. The Data page offers
    these names, and the -2 parts of a file past CSV_PART_BYTES from the export's list of downloads, so
    SHA256SUMS lists nothing it does not."""
    table, date_sql = YEARLY[prefix][:2]
    first = FIRST_YEAR[prefix]
    last = last if last is not None else datetime.now(timezone.utc).year
    years = _years(conn, table, date_sql)
    files = [(f"{prefix}-{y}.csv", _yearly_query(prefix), (y, str(int(y) + 1)))
             for y in years if first <= int(y) <= last]
    if any(int(y) < first for y in years):
        files.append((f"{prefix}-before-{first}.csv", _yearly_query(prefix, "before"), (str(first),)))
    if any(int(y) > last for y in years):
        files.append((f"{prefix}-after-{last}.csv", _yearly_query(prefix, "after"), (str(last + 1),)))
    if _undated(conn, table, date_sql):
        files.append((f"{prefix}-undated.csv", _yearly_query(prefix, "undated"), ()))
    return files


ALIASES_FILE = "organization-aliases.csv"
ALIAS_COLUMNS = ("from_id", "to_id", "reason", "note", "since")


def write_alias_map(conn: sqlite3.Connection, path: Path) -> int:
    """organization-aliases.csv: one row per retired id the site redirects (export_static.resolve_aliases, so the
    file and aliases/<ab>.json agree), sorted by from_id; returns its rows. reason NULL is a normalization change."""
    from .export_static import ORG_ID_RE, resolve_aliases  # export_static imports this module at load

    resolved = resolve_aliases(conn)
    own = {r[0]: r for r in conn.execute("SELECT old_id, reason, note, created_at FROM organization_aliases")}
    rows = []
    for old in sorted(resolved):
        new = resolved[old]
        if not (ORG_ID_RE.match(old) and ORG_ID_RE.match(new)):
            continue
        _, reason, note, created = own[old]
        rows.append((old, new, reason or "normalization", note or "", (created or "")[:10]))
    partial = path.with_name(path.name + ".partial")
    with partial.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(ALIAS_COLUMNS)
        writer.writerows(rows)
    partial.replace(path)
    return len(rows)


def write_sums(out: Path) -> int:
    lines = []
    for path in sorted(out.iterdir(), key=lambda p: p.name):
        if path.is_file() and path.name.endswith(".csv"):
            lines.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")
    (out / SUMS).write_text("".join(f"{line}\n" for line in lines), encoding="utf-8", newline="")
    return len(lines)


def export_csv(conn: sqlite3.Connection, out_dir: Path | None = None, *, today: date | None = None) -> dict[str, int]:
    """Write every download and SHA256SUMS; returns rows per file. today is the data date (UTC today by default)."""
    out = out_dir or (config.OUT_DIR / "csv")
    out.mkdir(parents=True, exist_ok=True)
    register_functions(conn)
    as_of = (today or datetime.now(timezone.utc).date()).isoformat()
    counts: dict[str, int] = {}
    counts["open-tenders.csv"] = _write(out / "open-tenders.csv", conn.execute(OPEN_TENDERS, {"as_of": as_of}))
    for prefix in YEARLY:
        for name, query, args in _yearly_files(conn, prefix, int(as_of[:4])):
            counts.update(_write_parts(out / name, conn.execute(query, args), CSV_PART_BYTES))
    counts["organizations.csv"] = _write(out / "organizations.csv", conn.execute(ORGANIZATIONS))
    counts["buyers.csv"] = _write(out / "buyers.csv", conn.execute(BUYERS, {"as_of": as_of}))
    for name, days in EXPIRING_WINDOW_FILES.items():
        counts[name] = _write(out / name, conn.execute(EXPIRING_WINDOW, {"as_of": as_of, "span": f"+{days} days"}))
    counts["expiring-12m.csv"] = _write(out / "expiring-12m.csv", conn.execute(EXPIRING))
    counts[ALIASES_FILE] = write_alias_map(conn, out / ALIASES_FILE)
    # A yearly file from an earlier night whose year no longer has rows (a
    # date corrected upstream) would otherwise be uploaded again.
    for stale in out.glob("*.csv"):
        if stale.name not in counts:
            stale.unlink()
    counts[SUMS] = write_sums(out)
    return counts


def run(conn: sqlite3.Connection, out_dir: Path | None = None, *, today: date | None = None) -> dict[str, int]:
    counts = export_csv(conn, out_dir, today=today)
    files = len(counts) - 1
    rows = sum(n for name, n in counts.items() if name != SUMS)
    log_run(conn, "export_csv", detail=f"files={files} rows={rows}", rows_in=rows, rows_new=files)
    return counts
