"""Yearly figures, buyer totals and code counts: the indicators stage.

Rebuilt whole every run, after the organizations stage, from the record
tables, by the rules in CLAUDE.md "Counting money" (the same rules
organizations.recompute applies to the all-time totals):

* award notices and PSPC contract history: one contract per reference
  number, valued on its newest amendment: total_value when positive, else
  amount; a cancelled contract counts zero; a currency other than CAD (blank
  is CAD) is left out of the totals. The organization is the newest version's
  supplier, or the newest earlier version's when the newest names none
  (organizations._newest_by_reference). The year is the calendar year of the
  newest version's award date.
* published contracts: each row on its own, valued at amendment_value when
  the row is an amendment (instrument type A, or amendment_value set and not
  zero), else original_value when set, else contract_value. The year is the
  contract date's.
* grants and contributions: one agreement per department and reference
  number, valued on its highest amendment; the year is that version's
  agreement start.

A record with no date in its source's date column has no year: it counts in
the all-time figures and in no yearly row (the log row says how many).
Counters (n) count what the totals add up, including the contracts a total
leaves out (another currency, cancelled). Competitive or not comes from the
stored competitive column (procurementMethod for awards and history,
solicitation_procedure for published contracts); grants have none, so their
non-competitive columns are NULL. A total is NULL when nothing in it was
CAD, and every total is rounded to the cent.

The buyer of a record is its buyer_id, except in the contract history, where
PSPC is the contracting entity of every row: there the buyer is the client
department (client_id), and PSPC only when no client is named. Tender
notices count once per reference, under the newest version's buyer.

Finally unspsc_codes.n and gsin_codes.n are recounted
(canadabuys.recount_codes: the notice versions carrying a code or a code
under it).
"""

from __future__ import annotations

import logging
import sqlite3

from . import organizations
from .db import log_run, now_iso
from .sources import canadabuys

log = logging.getLogger(__name__)

# Bumped when a counting rule changes, so a reader can tell which rules a
# figure was computed under.
RULES_VERSION = 1

AWARD_VALUE = (
    "CASE WHEN UPPER(TRIM(COALESCE(currency, ''))) NOT IN ('', 'CAD') THEN NULL "
    "WHEN status = 'cancelled' THEN 0 "
    "WHEN total_value > 0 THEN total_value "
    "ELSE COALESCE(amount, 0) END"
)
CONTRACT_VALUE = (
    "CASE WHEN instrument_type = 'A' OR (amendment_value IS NOT NULL AND amendment_value != 0) THEN amendment_value "
    "WHEN original_value IS NOT NULL THEN original_value "
    "ELSE value END"
)


def _year(column: str) -> str:
    return f"CASE WHEN {column} GLOB '[0-9][0-9][0-9][0-9]-*' THEN CAST(substr({column}, 1, 4) AS INTEGER) END"


# One row per counted record: its source, organization, buyer, year, value and competitiveness.
RECORDS = {
    "awards": (
        f"WITH newest AS ({organizations._newest_by_reference('awards', ('reference',))}) "
        f"SELECT 'awards', org, buyer_id, {_year('awarded')}, {AWARD_VALUE}, competitive FROM newest"
    ),
    "history": (
        f"WITH newest AS ({organizations._newest_by_reference('contract_history', ('reference',))}) "
        f"SELECT 'history', org, COALESCE(client_id, buyer_id), {_year('awarded')}, {AWARD_VALUE}, competitive "
        "FROM newest"
    ),
    "contracts": (
        f"SELECT 'contracts', organization_id, buyer_id, {_year('contract_date')}, {CONTRACT_VALUE}, competitive "
        "FROM contracts"
    ),
    "grants": (
        f"WITH newest AS ({organizations._newest_by_reference('grants', ('owner_org', 'reference'))}) "
        f"SELECT 'grants', org, buyer_id, {_year('start')}, value, NULL FROM newest"
    ),
}
SOURCES = tuple(RECORDS)
# The non-competitive columns, NULL for grants, which have no such notion.
_NON_COMPETITIVE = (
    "CASE WHEN source = 'grants' THEN NULL ELSE SUM(CASE WHEN comp = 0 THEN 1 ELSE 0 END) END",
    "ROUND(SUM(CASE WHEN comp = 0 THEN v END), 2)",
)
BUYER_FIELDS = ("n_tenders", "n_awards", "n_history", "n_contracts", "n_grants", "total_awards", "total_contracts",
                "total_grants")


def _load_records(conn: sqlite3.Connection) -> None:
    conn.execute("DROP TABLE IF EXISTS temp.indicator_records")
    conn.execute("CREATE TEMP TABLE indicator_records (source TEXT, org TEXT, buyer TEXT, year INTEGER, v REAL, "
                 "comp INTEGER)")
    for sql in RECORDS.values():
        conn.execute(f"INSERT INTO temp.indicator_records (source, org, buyer, year, v, comp) {sql}")


def _buyer_figures(conn: sqlite3.Connection) -> dict[str, dict[str, object]]:
    figures: dict[str, dict[str, object]] = {}
    for buyer, source, n, total in conn.execute(
        "SELECT buyer, source, COUNT(*), ROUND(SUM(v), 2) FROM temp.indicator_records WHERE buyer IS NOT NULL "
        "GROUP BY buyer, source"
    ):
        entry = figures.setdefault(buyer, {})
        entry[f"n_{source}"] = n
        if source != "history":  # buyers keep no history total (schema.sql)
            entry[f"total_{source}"] = total
    for buyer, n in conn.execute(
        "SELECT buyer_id, COUNT(*) FROM tenders t WHERE buyer_id IS NOT NULL "
        "AND amendment = (SELECT MAX(y.amendment) FROM tenders y WHERE y.reference = t.reference) GROUP BY buyer_id"
    ):
        figures.setdefault(buyer, {})["n_tenders"] = n
    return figures


def compute(conn: sqlite3.Connection, *, now: str | None = None) -> dict[str, int]:
    """Rebuild organization_years and buyer_years, update the buyers' figures, recount the codes."""
    stamp = now or now_iso()
    try:
        _load_records(conn)
        conn.execute("DELETE FROM organization_years")
        conn.execute(
            "INSERT INTO organization_years (organization_id, year, source, n, total, n_non_competitive, "
            f"total_non_competitive) SELECT org, year, source, COUNT(*), ROUND(SUM(v), 2), {_NON_COMPETITIVE[0]}, "
            f"{_NON_COMPETITIVE[1]} FROM temp.indicator_records WHERE org IS NOT NULL AND year IS NOT NULL "
            "GROUP BY org, year, source"
        )
        conn.execute("DELETE FROM buyer_years")
        conn.execute(
            "INSERT INTO buyer_years (buyer_id, year, source, n, total, n_non_competitive, total_non_competitive, "
            f"n_organizations) SELECT buyer, year, source, COUNT(*), ROUND(SUM(v), 2), {_NON_COMPETITIVE[0]}, "
            f"{_NON_COMPETITIVE[1]}, COUNT(DISTINCT org) FROM temp.indicator_records "
            "WHERE buyer IS NOT NULL AND year IS NOT NULL GROUP BY buyer, year, source"
        )
        figures = _buyer_figures(conn)
        changed = []
        for row in conn.execute(f"SELECT id, {', '.join(BUYER_FIELDS)} FROM buyers").fetchall():
            fig = figures.get(row["id"], {})
            new = {k: fig.get(k, 0 if k.startswith("n_") else None) for k in BUYER_FIELDS}
            if any(row[k] != new[k] for k in BUYER_FIELDS):
                changed.append((*(new[k] for k in BUYER_FIELDS), stamp, row["id"]))
        conn.executemany(
            f"UPDATE buyers SET {', '.join(f'{k} = ?' for k in BUYER_FIELDS)}, updated_at = ? WHERE id = ?", changed)
        no_year = dict(conn.execute(
            "SELECT source, COUNT(*) FROM temp.indicator_records WHERE year IS NULL "
            "AND (org IS NOT NULL OR buyer IS NOT NULL) GROUP BY source"
        ))
        records = conn.execute("SELECT COUNT(*) FROM temp.indicator_records").fetchone()[0]
        conn.execute("DROP TABLE temp.indicator_records")
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    canadabuys.recount_codes(conn)
    result = {
        "records": records,
        "organization_years": conn.execute("SELECT COUNT(*) FROM organization_years").fetchone()[0],
        "buyer_years": conn.execute("SELECT COUNT(*) FROM buyer_years").fetchone()[0],
        "buyers_updated": len(changed),
    }
    result.update({f"no_year_{s}": no_year.get(s, 0) for s in SOURCES})
    return result


def run(conn: sqlite3.Connection, *, now: str | None = None) -> dict[str, int]:
    result = compute(conn, now=now)
    log.info("indicators: %s", result)
    missing = ", ".join(f"{s} {result[f'no_year_{s}']}" for s in SOURCES if result[f"no_year_{s}"])
    detail = (f"records={result['records']} organization_years={result['organization_years']} "
              f"buyer_years={result['buyer_years']} buyers_updated={result['buyers_updated']} "
              f"rules_version={RULES_VERSION}")
    if missing:
        detail += f" without_year: {missing}"
    log_run(conn, "indicators", detail=detail, rows_in=result["records"],
            rows_new=result["organization_years"] + result["buyer_years"])
    return result
