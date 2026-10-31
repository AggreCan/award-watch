"""CSV downloads for the Data page, with a SHA256SUMS file to check them by.

Files (under data/out/csv; the workflow uploads them to R2 under downloads/,
and the site serves only these names):

  open-tenders.csv        every open tender notice at its newest amendment
  awards-<year>.csv       every award notice version whose award date (else
                          publication date) falls in the year
  history-<year>.csv      every contract history version, by the same rule
  organizations.csv       one row per organization: names, main place, counters and totals by source
  buyers.csv              one row per buyer: names, acronyms, counters and totals by source
  SHA256SUMS              sha256sum's format: "<hex>  <file>" per line, sorted by file name

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
import logging
import re
import sqlite3
from pathlib import Path

from . import config
from .db import log_run

log = logging.getLogger(__name__)

SUMS = "SHA256SUMS"
YEAR_RE = re.compile(r"^(awards|history)-\d{4}\.csv$")
FIXED_FILES = ("open-tenders.csv", "organizations.csv", "buyers.csv")

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

AWARDS = (
    "SELECT " + _CONTRACT_COLUMNS.format(extra="a.end_users_en,", codes="award_codes") +
    " FROM awards a LEFT JOIN buyers b ON b.id = a.buyer_id LEFT JOIN organizations o ON o.id = a.organization_id"
    " WHERE substr(COALESCE(a.awarded, a.published), 1, 4) = ? ORDER BY a.reference, a.amendment"
)
HISTORY = (
    "SELECT " + _CONTRACT_COLUMNS.format(
        extra="a.procurement_number, a.client_id, k.name_en AS client_name_en, a.client_raw_en,",
        codes="history_codes") +
    " FROM contract_history a LEFT JOIN buyers b ON b.id = a.buyer_id LEFT JOIN buyers k ON k.id = a.client_id"
    " LEFT JOIN organizations o ON o.id = a.organization_id"
    " WHERE substr(COALESCE(a.awarded, a.published), 1, 4) = ? ORDER BY a.reference, a.amendment"
)
ORGANIZATIONS = """
    SELECT id, display_name, country, province, city, business_number, first_seen, last_seen, n_awards,
           total_awards, n_history, total_history, n_contracts, total_contracts, n_grants, total_grants, n_lobbying
    FROM organizations ORDER BY norm_name, id"""
BUYERS = """
    SELECT id, name_en, name_fr, acronym_en, acronym_fr, ckan_org, department_number, kind, n_tenders, n_awards,
           total_awards, n_history, n_contracts, total_contracts, n_grants, total_grants
    FROM buyers ORDER BY id"""


def _cell(value: object) -> object:
    # Floats in a fixed form, so a value read back the same writes the same bytes.
    if isinstance(value, float):
        return f"{value:.2f}"
    return "" if value is None else value


def _write(path: Path, cur: sqlite3.Cursor) -> int:
    """One CSV through a partial file, renamed when complete, so a failure never leaves a truncated file for the upload."""
    headers = [d[0] for d in cur.description]
    part = path.with_name(path.name + ".partial")
    n = 0
    with part.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(headers)
        for row in cur:
            writer.writerow([_cell(v) for v in row])
            n += 1
    part.replace(path)
    return n


def _years(conn: sqlite3.Connection, table: str) -> list[str]:
    return [y for (y,) in conn.execute(
        f"SELECT DISTINCT substr(COALESCE(awarded, published), 1, 4) FROM {table} "
        "WHERE COALESCE(awarded, published) GLOB '[0-9][0-9][0-9][0-9]-*' ORDER BY 1")]


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
        for year in _years(conn, table):
            name = f"{prefix}-{year}.csv"
            counts[name] = _write(out / name, conn.execute(sql, (year,)))
    counts["organizations.csv"] = _write(out / "organizations.csv", conn.execute(ORGANIZATIONS))
    counts["buyers.csv"] = _write(out / "buyers.csv", conn.execute(BUYERS))
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
