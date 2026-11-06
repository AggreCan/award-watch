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
leaves out (another currency, cancelled, no value published, a value flagged
for checking). A value the source did not publish is NULL, never 0, and
n_no_value beside each total counts the records left out that way; a value
value_checks.py flagged is left out of every total and kept on its record
(organizations.award_value and the other rules there). Competitive or not comes from the
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
# figure was computed under. 2: a value the source did not publish is NULL
# (no longer 0), and a value flagged for checking is left out of the totals.
RULES_VERSION = 2

# The rules as they read a version row, without the value checks: the value
# a row shows (expiring.py, the export) as against the value a total adds.
AWARD_VALUE = organizations.award_value("award", checked=False)
CONTRACT_VALUE = organizations.CONTRACT_OWN


def _year(column: str) -> str:
    return f"CASE WHEN {column} GLOB '[0-9][0-9][0-9][0-9]-*' THEN CAST(substr({column}, 1, 4) AS INTEGER) END"


# One row per counted record: its source, organization, buyer, year, the value a total adds (NULL when another
# currency, not published or flagged), competitiveness, 1 when the source published no value, 1 when flagged.
RECORD_COLUMNS = ("source", "org", "buyer", "year", "v", "comp", "nv", "chk")
RECORDS = {
    "awards": (
        f"WITH newest AS ({organizations._newest_by_reference('awards', ('reference',))}) "
        f"SELECT 'awards', org, buyer_id, {_year('awarded')}, {organizations.award_value('award')}, competitive, "
        f"{organizations.AWARD_NO_VALUE}, {organizations.award_flagged('award')} FROM newest"
    ),
    "history": (
        f"WITH newest AS ({organizations._newest_by_reference('contract_history', ('reference',))}) "
        f"SELECT 'history', org, COALESCE(client_id, buyer_id), {_year('awarded')}, "
        f"{organizations.award_value('history')}, competitive, {organizations.AWARD_NO_VALUE}, "
        f"{organizations.award_flagged('history')} FROM newest"
    ),
    "contracts": (
        f"SELECT 'contracts', organization_id, buyer_id, {_year('contract_date')}, {organizations.CONTRACT_CHECKED}, "
        f"competitive, {organizations.CONTRACT_NO_VALUE}, {organizations.CONTRACT_FLAGGED} FROM contracts"
    ),
    "grants": (
        f"WITH newest AS ({organizations._newest_by_reference('grants', ('owner_org', 'reference'))}) "
        f"SELECT 'grants', org, buyer_id, {_year('start')}, value, NULL, {organizations.GRANT_NO_VALUE}, 0 FROM newest"
    ),
}
SOURCES = tuple(RECORDS)
# The non-competitive columns, NULL for grants, which have no such notion.
_NON_COMPETITIVE = (
    "CASE WHEN source = 'grants' THEN NULL ELSE SUM(CASE WHEN comp = 0 THEN 1 ELSE 0 END) END",
    "ROUND(SUM(CASE WHEN comp = 0 THEN v END), 2)",
)
# The positive values alone, for the non-competitive share by value: an
# amendment that lowers a published contract is a negative row, and a share
# of a net total can fall below zero (one profile read -10 percent).
_POSITIVE = (
    "ROUND(SUM(CASE WHEN v > 0 THEN v END), 2), "
    "CASE WHEN source = 'grants' THEN NULL ELSE ROUND(SUM(CASE WHEN comp = 0 AND v > 0 THEN v END), 2) END, "
    "SUM(CASE WHEN v < 0 THEN 1 ELSE 0 END)"
)
BUYER_FIELDS = ("n_tenders", "n_awards", "n_history", "n_contracts", "n_grants", "total_awards", "total_contracts",
                "total_grants", "n_awards_no_value", "n_contracts_no_value", "n_grants_no_value", "n_lobbying")


def load_records(conn: sqlite3.Connection, table: str) -> None:
    """Fill a new temporary table with RECORDS (indicators and the export each build their own)."""
    conn.execute(f"DROP TABLE IF EXISTS temp.{table}")
    conn.execute(f"CREATE TEMP TABLE {table} (source TEXT, org TEXT, buyer TEXT, year INTEGER, v REAL, comp INTEGER, "
                 "nv INTEGER, chk INTEGER)")
    for sql in RECORDS.values():
        conn.execute(f"INSERT INTO temp.{table} ({', '.join(RECORD_COLUMNS)}) {sql}")


def _load_records(conn: sqlite3.Connection) -> None:
    load_records(conn, "indicator_records")


def _buyer_figures(conn: sqlite3.Connection) -> dict[str, dict[str, object]]:
    figures: dict[str, dict[str, object]] = {}
    for buyer, source, n, total, no_value in conn.execute(
        "SELECT buyer, source, COUNT(*), ROUND(SUM(v), 2), SUM(nv) FROM temp.indicator_records WHERE buyer IS NOT NULL "
        "GROUP BY buyer, source"
    ):
        entry = figures.setdefault(buyer, {})
        entry[f"n_{source}"] = n
        if source != "history":  # buyers keep no history total (schema.sql)
            entry[f"total_{source}"] = total
            entry[f"n_{source}_no_value"] = no_value or 0
    for buyer, n in conn.execute(
        "SELECT buyer_id, COUNT(*) FROM tenders t WHERE buyer_id IS NOT NULL "
        "AND amendment = (SELECT MAX(y.amendment) FROM tenders y WHERE y.reference = t.reference) GROUP BY buyer_id"
    ):
        figures.setdefault(buyer, {})["n_tenders"] = n
    # The lobbying reports that name a buyer among the institutions lobbied
    # (buyer_ids, sources/lobbying.py, each id once a report): what lists an
    # institution only the registry names (sources/buyers.refresh_kinds).
    for buyer, n in conn.execute(
        "SELECT j.value, COUNT(*) FROM lobbying_communications l, json_each(l.buyer_ids) j "
        "WHERE l.buyer_ids IS NOT NULL AND json_valid(l.buyer_ids) AND json_type(l.buyer_ids) = 'array' "
        "AND j.type = 'text' GROUP BY j.value"
    ):
        figures.setdefault(buyer, {})["n_lobbying"] = n
    return figures


def compute(conn: sqlite3.Connection, *, now: str | None = None) -> dict[str, int]:
    """Rebuild organization_years and buyer_years, update the buyers' figures, recount the codes."""
    stamp = now or now_iso()
    try:
        _load_records(conn)
        conn.execute("DELETE FROM organization_years")
        conn.execute(
            "INSERT INTO organization_years (organization_id, year, source, n, total, n_non_competitive, "
            "total_non_competitive, n_no_value, total_positive, total_non_competitive_positive, n_negative) "
            f"SELECT org, year, source, COUNT(*), ROUND(SUM(v), 2), "
            f"{_NON_COMPETITIVE[0]}, {_NON_COMPETITIVE[1]}, SUM(nv), {_POSITIVE} FROM temp.indicator_records "
            "WHERE org IS NOT NULL AND year IS NOT NULL GROUP BY org, year, source"
        )
        conn.execute("DELETE FROM buyer_years")
        conn.execute(
            "INSERT INTO buyer_years (buyer_id, year, source, n, total, n_non_competitive, total_non_competitive, "
            f"n_organizations, n_no_value) SELECT buyer, year, source, COUNT(*), ROUND(SUM(v), 2), "
            f"{_NON_COMPETITIVE[0]}, {_NON_COMPETITIVE[1]}, COUNT(DISTINCT org), SUM(nv) FROM temp.indicator_records "
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
