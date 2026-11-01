"""CSV downloads for the Data page, with a SHA256SUMS file to check them by.

Files (under data/out/csv; the workflow uploads them to R2 under downloads/,
and the site serves only these names):

  open-tenders.csv        every open tender notice at its newest amendment
  awards-<year>.csv       every award notice version whose award date (else
                          publication date) falls in the year, from FIRST_YEAR["awards"] (2012)
  awards-before-2012.csv  the award notice versions dated before it: a handful of rows whose dates
                          are typing errors in the source, in one file rather than a file a year
  history-<year>.csv      every contract history version, by the same rule, from 2009
  history-before-2009.csv the same for the contract history (written only when such a row exists)
  organizations.csv       one row per organization: names, main place, counters and totals by source,
                          and beside each total the count of records whose source published no value
  buyers.csv              one row per buyer: names, acronyms, counters and totals by source, the same
  expiring-12m.csv        the expiring-contracts radar: every contract ending within 365 days, listed
                          once across the three sources (expiring.py), soonest end first, with the
                          client department and the value flag
  SHA256SUMS              sha256sum's format: "<hex>  <file>" per line, sorted by file name

Every CSV opens with a UTF-8 byte-order mark, so a spreadsheet reads the
French names as written, and a list field (provinces, segments, end users) is
its values joined by "; " ("SK; MB"), never a JSON array. A value the source
did not publish is an empty cell, never 0. SHA256SUMS is computed on the bytes
written, mark included. The award and history files carry value_flag
("check" when value_checks.py flagged the contract's value).

What never goes in a file: the contacts on tender and award notices, supplier
street addresses, and any name the loaders withheld as a private individual
(supplier_raw is NULL on those rows and supplier_withheld says so). Rows are
sorted and every value is written the same way each night, so an unchanged
year keeps its bytes.

The downloads are the records as published, one row per version: the totals
the site shows follow CLAUDE.md "Counting money" and add one version per
contract, so a reader adding up these files would count a contract once per
amendment.
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import re
import sqlite3
from pathlib import Path

from . import config
from .db import log_run

log = logging.getLogger(__name__)

SUMS = "SHA256SUMS"

# -- contact details inside the publishers' own text ------------------------------
#
# Descriptions and titles are the publisher's prose, and some carry a
# contracting officer's email address or telephone number ("send questions to
# the inbox X@... or call 613-..."). Contacts are never exported (CLAUDE.md rule
# 3), so every free-text field the exports write goes through scrub: an email
# address, a North American telephone or fax number (with or without
# separators, a leading 1 or +1, an extension), and any other run of ten or
# more digits become the placeholder in the field's language. A long digit run
# is sometimes a solicitation number rather than a telephone number; losing it
# from prose costs less than publishing a number that is someone's line.

REMOVED = {"en": "[contact removed]", "fr": "[coordonnées retirées]"}
# The fields whose text is the publisher's prose; names and code lists are not.
FREE_TEXT_KEY = re.compile(r"^(title|description|comments|program|selection|limited_reason)_(en|fr)$")
# An address may carry a space on either side of the @ in prose; its domain has a dot.
EMAIL_RE = re.compile(r"[\w.+%'-]+\s?@\s?[\w-]+(?:\.[\w-]+)+")
PHONE_RE = re.compile(
    r"(?<![\w+])(?:\+\s?1[\s.-]?|1[\s.-])?(?:\(\s?\d{3}\s?\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}"
    r"(?:\s*(?:ext\.?|extension|x|poste|p\.)\s*\d{1,6})?(?!\w)",
    re.IGNORECASE,
)
LONG_DIGITS_RE = re.compile(r"\d{10,}")


def scrub(text: object, lang: str = "en") -> object:
    """text with every email address, telephone or fax number and long digit run replaced; anything else as given."""
    if not isinstance(text, str) or not text:
        return text
    mark = REMOVED["fr" if lang == "fr" else "en"]
    out = LONG_DIGITS_RE.sub(mark, PHONE_RE.sub(mark, EMAIL_RE.sub(mark, text)))
    # An @ the address pattern did not take (a broken address) still goes.
    return out.replace("@", mark)


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


YEAR_RE = re.compile(r"^(awards|history)-(?:before-)?\d{4}\.csv$")
# The first year with a file of its own; earlier dates are typing errors in the source and share one file.
FIRST_YEAR = {"awards": 2012, "history": 2009}
FIXED_FILES = ("open-tenders.csv", "organizations.csv", "buyers.csv", "expiring-12m.csv")

OPEN_TENDERS = """
    SELECT t.reference, t.amendment, t.solicitation, t.title_en, t.title_fr, t.published, t.closing, t.amended,
           t.status, t.category, t.notice_type_en, t.method_en, t.selection_en, t.limited_reason_en,
           t.trade_agreements_en, t.regions_delivery_en, t.provinces, t.buyer_id, b.name_en AS buyer_name_en,
           b.name_fr AS buyer_name_fr, t.buyer_raw_en, t.end_users_en,
           (SELECT group_concat(c.unspsc, ' ') FROM tender_codes c WHERE c.reference = t.reference
              AND c.amendment = t.amendment) AS unspsc,
           t.gsin, t.description_en, t.description_fr, t.source_file, t.first_seen, t.last_seen
    FROM tenders t LEFT JOIN buyers b ON b.id = t.buyer_id
    WHERE t.status = 'open' AND t.amendment = (SELECT MAX(y.amendment) FROM tenders y WHERE y.reference = t.reference)
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
    a.gsin, a.provinces, a.source_file, a.first_seen, a.last_seen"""

_FLAG = "(SELECT 'check' FROM value_flags f WHERE f.kind = '{kind}' AND f.key = a.reference) AS value_flag,"
AWARDS = (
    "SELECT " + _CONTRACT_COLUMNS.format(extra="a.end_users_en, " + _FLAG.format(kind="award"), codes="award_codes") +
    " FROM awards a LEFT JOIN buyers b ON b.id = a.buyer_id LEFT JOIN organizations o ON o.id = a.organization_id"
    " WHERE substr(COALESCE(a.awarded, a.published), 1, 4) = ? ORDER BY a.reference, a.amendment"
)
HISTORY = (
    "SELECT " + _CONTRACT_COLUMNS.format(
        extra="a.procurement_number, a.client_id, k.name_en AS client_name_en, a.client_raw_en, "
              + _FLAG.format(kind="history"),
        codes="history_codes") +
    " FROM contract_history a LEFT JOIN buyers b ON b.id = a.buyer_id LEFT JOIN buyers k ON k.id = a.client_id"
    " LEFT JOIN organizations o ON o.id = a.organization_id"
    " WHERE substr(COALESCE(a.awarded, a.published), 1, 4) = ? ORDER BY a.reference, a.amendment"
)
ORGANIZATIONS = """
    SELECT id, display_name, country, province, city, business_number, first_seen, last_seen, n_awards,
           total_awards, n_awards_no_value, n_history, total_history, n_history_no_value, n_contracts, total_contracts,
           n_contracts_no_value, n_grants, total_grants, n_grants_no_value, n_lobbying
    FROM organizations ORDER BY norm_name, id"""
EXPIRING = """
    SELECT kind, reference, title_en, title_fr, organization_id, organization, supplier_withheld, buyer_id, buyer_en,
           buyer_fr, start, end, days_left, value, currency, competitive, method_en, instrument_en, n_amendments,
           value_growth, tender_reference, segments, provinces, client_buyer_id, client_buyer_name,
           client_buyer_name_fr, value_flag
    FROM expiring_contracts ORDER BY end, source_key"""
BUYERS = """
    SELECT id, name_en, name_fr, acronym_en, acronym_fr, ckan_org, department_number, kind, n_tenders, n_awards,
           total_awards, n_awards_no_value, n_history, n_contracts, total_contracts, n_contracts_no_value, n_grants,
           total_grants, n_grants_no_value
    FROM buyers ORDER BY id"""


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


def _write(path: Path, cur: sqlite3.Cursor) -> int:
    """One CSV through a partial file, renamed when complete, so a failure never leaves a truncated file for the upload."""
    headers = [d[0] for d in cur.description]
    langs = [(m.group(2) if (m := FREE_TEXT_KEY.match(h)) else None) for h in headers]
    part = path.with_name(path.name + ".partial")
    n = 0
    # utf-8-sig: the byte-order mark makes a spreadsheet read the file as UTF-8.
    with part.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(headers)
        for row in cur:
            writer.writerow([_cell(scrub(v, lang) if lang else v) for v, lang in zip(row, langs)])
            n += 1
    part.replace(path)
    return n


def _years(conn: sqlite3.Connection, table: str) -> list[str]:
    return [y for (y,) in conn.execute(
        f"SELECT DISTINCT substr(COALESCE(awarded, published), 1, 4) FROM {table} "
        "WHERE COALESCE(awarded, published) GLOB '[0-9][0-9][0-9][0-9]-*' ORDER BY 1")]


def _yearly_files(conn: sqlite3.Connection, prefix: str, table: str, sql: str) -> list[tuple[str, str, tuple]]:
    """(file name, query, arguments) for each yearly file of a table: one per year from FIRST_YEAR, and the
    years before it together in <prefix>-before-<FIRST_YEAR>.csv (the Data page lists the years it has)."""
    first = FIRST_YEAR[prefix]
    years = _years(conn, table)
    files = [(f"{prefix}-{y}.csv", sql, (y,)) for y in years if int(y) >= first]
    if any(int(y) < first for y in years):
        where = "WHERE substr(COALESCE(a.awarded, a.published), 1, 4) = ? ORDER BY a.reference"
        if where not in sql:
            raise ValueError(f"{prefix}: the yearly query no longer reads its year as expected")
        before = sql.replace(where, "WHERE substr(COALESCE(a.awarded, a.published), 1, 4) < ? "
                                    "ORDER BY substr(COALESCE(a.awarded, a.published), 1, 10), a.reference")
        files.append((f"{prefix}-before-{first}.csv", before, (str(first),)))
    return files


def write_sums(out: Path) -> int:
    lines = []
    for path in sorted(out.iterdir(), key=lambda p: p.name):
        if path.is_file() and path.name.endswith(".csv"):
            lines.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")
    (out / SUMS).write_text("".join(f"{line}\n" for line in lines), encoding="utf-8", newline="")
    return len(lines)


def export_csv(conn: sqlite3.Connection, out_dir: Path | None = None) -> dict[str, int]:
    """Write every download and SHA256SUMS; returns rows per file."""
    out = out_dir or (config.OUT_DIR / "csv")
    out.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    counts["open-tenders.csv"] = _write(out / "open-tenders.csv", conn.execute(OPEN_TENDERS))
    for prefix, table, sql in (("awards", "awards", AWARDS), ("history", "contract_history", HISTORY)):
        for name, query, args in _yearly_files(conn, prefix, table, sql):
            counts[name] = _write(out / name, conn.execute(query, args))
    counts["organizations.csv"] = _write(out / "organizations.csv", conn.execute(ORGANIZATIONS))
    counts["buyers.csv"] = _write(out / "buyers.csv", conn.execute(BUYERS))
    counts["expiring-12m.csv"] = _write(out / "expiring-12m.csv", conn.execute(EXPIRING))
    # A yearly file from an earlier night whose year no longer has rows (a
    # date corrected upstream) would otherwise be uploaded again.
    for stale in out.glob("*.csv"):
        if stale.name not in counts:
            stale.unlink()
    counts[SUMS] = write_sums(out)
    return counts


def run(conn: sqlite3.Connection, out_dir: Path | None = None) -> dict[str, int]:
    counts = export_csv(conn, out_dir)
    files = len(counts) - 1
    rows = sum(n for name, n in counts.items() if name != SUMS)
    log_run(conn, "export_csv", detail=f"files={files} rows={rows}", rows_in=rows, rows_new=files)
    return counts
