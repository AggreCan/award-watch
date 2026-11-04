"""Command line: `python -m awardwatch_pipeline run`, the nightly refresh, one stage after another,
the search database's search-sync, search-check and search-synced (search_db.py), and the records
database's records-sync, records-check and records-synced (records_db.py).

The stages run in CLAUDE.md's order. Each records one sources_log row (the
module writes it on success, _stage on a failure) and never stops the stages
after it. `--samples` reads data/raw/samples/*.csv instead of fetching and
makes no request at all (no CKAN organizations, no registry download).
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from . import config, organizations
from .db import connect, log_run
from .http import PoliteClient
from .sources import buyers, canadabuys, registry_federal
from . import indicators
from . import expiring, export, export_static, migrate
from . import records_db, search_db
from .sources import contracts, grants, lobbying, matching

log = logging.getLogger("awardwatch_pipeline")
STAGES = ["buyers", "tenders", "awards", "history", "contracts", "grants", "lobbying", "registry",
          "organizations", "indicators", "expiring", "export"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="awardwatch_pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="collect, merge, compute and export")
    for stage in STAGES:
        run.add_argument(f"--{stage}", action="store_true", help=f"run only the {stage} stage (combinable)")
    run.add_argument("--samples", action="store_true",
                     help="read data/raw/samples/*.csv instead of fetching; no network requests (dev runs)")
    run.add_argument("--db", default=None, help="SQLite path (default data/awardwatch.sqlite)")
    # The hosted search database's sync (search_db.py, docs/hosted-search.md):
    # search-sync, search-check and search-synced, run by the workflow around
    # its Wrangler calls after the export.
    search_db.add_parsers(sub)
    # The records database's sync (records_db.py, docs/analytics.md), the same
    # three steps around the workflow's Wrangler calls.
    records_db.add_parsers(sub)
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    # Every stage reports its own failure; this catches what is left (a
    # database that will not open, a full disk) so the workflow always gets an
    # exit code and a log line rather than a traceback from the interpreter.
    try:
        if args.command in search_db.COMMANDS:
            return search_db.command(args)
        if args.command in records_db.COMMANDS:
            return records_db.command(args)
        conn = connect(args.db)
        try:
            return run(conn, [s for s in STAGES if getattr(args, s)], samples=config.SAMPLES_DIR if args.samples else None)
        finally:
            # Closing folds the write-ahead log into the database file, which
            # is the file the workflow compresses and saves.
            conn.close()
    except Exception:
        log.exception("%s stopped", args.command)
        return 2


def _not_built(conn: sqlite3.Connection, stage: str) -> str:
    log_run(conn, stage, detail="not built", notice=f"the {stage} stage is not built yet")
    return "not built"


class ExportIncomplete(RuntimeError):
    """The static export was written but the CSV downloads were not (export_csv has the reason)."""


def _export(conn: sqlite3.Connection) -> dict[str, int]:
    """The export stage: the CSV downloads, then the static JSON (feeds and
    sitemaps inside it), which writes the stage's log row. A CSV failure is
    recorded as export_csv and does not hold back the files the site serves;
    it is raised after them, so the stage still reads as failed."""
    # One data date for both, so the CSV and the static files list the same open notices.
    today = datetime.now(timezone.utc).date()
    # The rows of each CSV file as written, for the Data page's list of downloads.
    rows: dict[str, int] = {}
    csv_ok = _stage(conn, "export_csv", lambda: rows.update(export.export_csv(conn, today=today)) or rows)
    counts = export_static.export_static(conn, today=today, csv_rows=rows if csv_ok else None)
    if not csv_ok:
        raise ExportIncomplete("the static files were written; the CSV downloads failed (see export_csv)")
    return counts


def stage_runners(conn: sqlite3.Connection, client: PoliteClient | None,
                  samples: Path | None) -> dict[str, Callable[[], Any]]:
    """What each stage runs. A stage that is built replaces its _not_built line."""
    offline = samples is not None
    return {
        "buyers": lambda: buyers.run(conn, client, offline=offline),
        "tenders": lambda: canadabuys.run(conn, client, "tenders", samples=samples),
        "awards": lambda: canadabuys.run(conn, client, "awards", samples=samples),
        "history": lambda: canadabuys.run(conn, client, "history", samples=samples),
        "contracts": lambda: contracts.run(conn, client, samples=samples),
        "grants": lambda: grants.run(conn, client, samples=samples),
        "lobbying": lambda: lobbying.run(conn, client, samples=samples),
        # A 260 MB download can fail; the rest of the night still runs.
        "registry": lambda: registry_federal.run(conn, client, download=not offline),
        "organizations": lambda: organizations.run(conn),
        "indicators": lambda: indicators.run(conn),
        "expiring": lambda: expiring.run(conn),
        "export": lambda: _export(conn),
    }


def run(conn: sqlite3.Connection, selected: list[str], *, samples: Path | None = None,
        client: PoliteClient | None = None) -> int:
    """Run the selected stages (all when none is), in STAGES order; 0 when every one was ok."""
    stages = [s for s in STAGES if s in selected] or STAGES
    if client is None and samples is None:
        client = PoliteClient()
    runners = stage_runners(conn, client, samples)
    # Before any stage writes an id: a change to the name rules moves every
    # record to its new id first (a no-op on a current database).
    ok = _stage(conn, "migrate", lambda: migrate.ensure_current(conn))
    # A changed person test: every loader reads its files again, so which rows
    # are withheld is recomputed (a no-op when the version is current).
    if matching.refresh_person_test(conn):
        log.info("person test version %s: every file is read again", matching.PERSON_TEST_VERSION)
    for stage in stages:
        ok &= _stage(conn, stage, runners[stage])
    return 0 if ok else 1


def _stage(conn: sqlite3.Connection, source: str, fn: Callable[[], Any]) -> bool:
    """Run one stage. Any exception is logged, recorded in sources_log (which
    is what the run status reports) and returned as False, so the stages after
    it still run and nothing propagates out of main. Work the stage left
    uncommitted is rolled back rather than committed by the log row."""
    try:
        result = fn()
    except Exception as exc:
        log.exception("%s failed", source)
        try:
            conn.rollback()
            log_run(conn, source, detail=f"{type(exc).__name__}: {exc}"[:900], ok=False)
        except sqlite3.Error as db_exc:
            log.error("%s: the failure could not be recorded: %s", source, db_exc)
        return False
    log.info("%s: %s", source, result)
    return True


if __name__ == "__main__":
    sys.exit(main())
