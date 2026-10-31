"""Re-key every record's organization after a change to name normalization.

An organization id is sha1 of normalize.norm_name of the legal name, so a
change to norm_name (a new normalize.NORMALIZE_VERSION) moves records to other
ids: spellings that differed only by punctuation, a suffix or an accent come to
share one, and a few that shared one come apart. Each record table keeps the
spelling it was loaded under (ID_COLUMNS), so the new id of
every record is computed from it the way organizations.upsert computes it at
load, and:

* every row of awards, contract_history, contracts, grants and
  lobbying_communications whose spelling now gives another id moves to it; a
  row whose supplier, vendor, recipient or client was withheld has no
  spelling and no organization, and stays as it is;
* an organizations row is created for each new id, and
  organizations.recompute then rebuilds names, places, counters and totals
  and removes the ids no record points to any more (with their registry
  rows);
* each retired id goes into organization_aliases with the id most of its
  records went to (ties to the lower id), so a link to the old profile is sent
  on (export_static.write_aliases); an alias that pointed at an id retired now
  moves forward to the new one;
* the federal corporations extract is re-normalized and matched again; the
  yearly figures are the indicators stage's, rebuilt whole every run.

The pipeline runs this before the stages, once, when meta.normalize_version
differs from NORMALIZE_VERSION (or is missing on a database that has
organizations), in one transaction. Running it again on a migrated database
changes nothing. The site's own tables in D1 (organization_responses,
corrections) keep the ids they were written with; the aliases send their
readers on.
"""

from __future__ import annotations

import logging
import sqlite3
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass

from . import organizations
from .db import get_meta, log_run, now_iso, set_meta
from .normalize import NORMALIZE_VERSION, norm_name, org_id
from .sources import matching, registry_federal

log = logging.getLogger(__name__)

META_KEY = "normalize_version"
# The column each record table's organization id is made from at load (the
# legal name; organizations.NAME_COLUMNS also lists the grants' operating
# name, which is counted as a spelling but never decides the id).
ID_COLUMNS = (("awards", "supplier_raw"), ("contract_history", "supplier_raw"), ("contracts", "vendor_raw"),
              ("grants", "legal_name"), ("lobbying_communications", "client_raw"))


@dataclass
class Report:
    organizations_before: int = 0
    organizations_after: int = 0
    rows_moved: int = 0
    ids_retired: int = 0
    aliases_written: int = 0
    aliases_moved: int = 0
    registry_renormalized: int = 0

    def __str__(self) -> str:
        return " ".join(f"{k}={v}" for k, v in asdict(self).items())


def current_version(conn: sqlite3.Connection) -> int | None:
    value = get_meta(conn, META_KEY)
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def new_id(raw: str | None) -> tuple[str | None, str | None]:
    """(id, the spelling's first-language form) for a record's spelling, as organizations.upsert derives it."""
    text = matching.first_language(raw)
    if not text or matching.is_placeholder(text):
        return None, None
    norm = norm_name(text)
    return (org_id(norm), text) if norm else (None, None)


def _referenced(conn: sqlite3.Connection) -> set[str]:
    out: set[str] = set()
    for table in organizations.RECORD_TABLES:
        out.update(r[0] for r in conn.execute(f"SELECT DISTINCT organization_id FROM {table} WHERE organization_id IS NOT NULL"))
    return out


def migrate(conn: sqlite3.Connection, *, now: str | None = None) -> Report:
    """Move every record to the id its spelling gives under the current rules; one transaction."""
    stamp = now or now_iso()
    report = Report(organizations_before=conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0])
    moves: Counter[tuple[str, str]] = Counter()
    try:
        existing = {r[0] for r in conn.execute("SELECT id FROM organizations")}
        updates: dict[str, list[tuple[str, int]]] = defaultdict(list)
        for table, column in ID_COLUMNS:
            for rowid, old, raw in conn.execute(
                    f"SELECT rowid, organization_id, {column} FROM {table} WHERE {column} IS NOT NULL").fetchall():
                oid, text = new_id(raw)
                if oid is None or oid == old:
                    continue
                if oid not in existing:
                    conn.execute(
                        "INSERT INTO organizations (id, display_name, norm_name, updated_at) VALUES (?, ?, ?, ?) "
                        "ON CONFLICT(id) DO NOTHING", (oid, text, norm_name(text), stamp))
                    existing.add(oid)
                updates[table].append((oid, rowid))
                if old:
                    moves[(old, oid)] += 1
        for table, rows in updates.items():
            conn.executemany(f"UPDATE {table} SET organization_id = ? WHERE rowid = ?", rows)
            report.rows_moved += len(rows)

        live = _referenced(conn)
        targets: dict[str, Counter[str]] = defaultdict(Counter)
        for (old, new), n in moves.items():
            targets[old][new] += n
        for old, counts in sorted(targets.items()):
            if old in live:
                continue
            target = min(counts, key=lambda k: (-counts[k], k))
            conn.execute(
                "INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(old_id) DO UPDATE SET new_id = excluded.new_id, "
                "normalize_version = excluded.normalize_version, created_at = excluded.created_at",
                (old, target, NORMALIZE_VERSION, stamp))
            report.aliases_written += 1
            report.aliases_moved += conn.execute(
                "UPDATE organization_aliases SET new_id = ? WHERE new_id = ? AND old_id != ?", (target, old, target)
            ).rowcount
            report.ids_retired += 1
        # An id that is live again answers for itself (export_static.resolve_aliases skips it too).
        conn.execute("DELETE FROM organization_aliases WHERE old_id IN (SELECT id FROM organizations o WHERE "
                     + " OR ".join(f"EXISTS (SELECT 1 FROM {t} WHERE organization_id = o.id)" for t in organizations.RECORD_TABLES)
                     + ")")
        set_meta(conn, META_KEY, NORMALIZE_VERSION)
        # recompute commits: the moves, the aliases and the version land together.
        organizations.recompute(conn, now=stamp)
    except BaseException:
        conn.rollback()
        raise
    report.registry_renormalized = registry_federal.renormalize(conn)
    registry_federal.match(conn, now=stamp)
    report.organizations_after = conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0]
    return report


def ensure_current(conn: sqlite3.Connection, *, now: str | None = None) -> Report | None:
    """Migrate when the database's ids were made under other rules; None when nothing had to move."""
    have = current_version(conn)
    if have == NORMALIZE_VERSION:
        return None
    if conn.execute("SELECT 1 FROM organizations LIMIT 1").fetchone() is None:
        # A new database: every id it will hold is made under the current rules.
        set_meta(conn, META_KEY, NORMALIZE_VERSION)
        conn.commit()
        return None
    report = migrate(conn, now=now)
    log.info("migrate: normalize version %s -> %s: %s", have, NORMALIZE_VERSION, report)
    log_run(conn, "migrate", detail=f"normalize_version {have} -> {NORMALIZE_VERSION}: {report}"[:900],
            rows_in=report.organizations_before, rows_new=report.rows_moved)
    return report
