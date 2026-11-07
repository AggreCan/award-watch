"""The families stage: corporate families from a curated seed, shown side by side and never added up.

The operator's ruling of 2026-11-07 (number 4): one brand often publishes
under several legal entities ("Stantec Consulting Ltd.", "Stantec
Architecture Ltd.", a joint venture naming Stantec), each a profile of its
own with its own figures, and a reader watching the brand wants to find the
others. A family says they belong together without merging them: each
member keeps its id, records and totals, and no figure anywhere adds the
members together (CLAUDE.md "Never add across sources" applies within a
family too).

The seed is awardwatch_pipeline/data/organization_families.csv (family,
member_norm, note, source; its header comment is the format), curated by
hand with a source per row: a URL, or "name" when the member's name states
the relation. Names alone never make a family (a first word in common joins
Bell Canada and Bell Textron), so nothing here is inferred.

The stage runs after the organizations stage, so a member merged tonight
counts as the organization that took its records (organization_aliases,
chains followed to a live id). It rebuilds organization_families whole, in
one transaction. A row it cannot use is skipped and logged, and the rest of
the seed still applies: a note outside NOTES, no source, a member that names
no organization with records, or a member a family before it already holds.
The export (export_static.profile_families) writes each member's profile a
"family" block: the family's name and its members by records, each with its
own count and note.
"""

from __future__ import annotations

import csv
import io
import logging
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from . import config
from .db import log_run
from .normalize import norm_name, org_id, squash

log = logging.getLogger(__name__)

SEED_PATH = config.PACKAGE_DATA / "organization_families.csv"
SEED_COLUMNS = ("family", "member_norm", "note", "source")
NOTES = ("subsidiary", "affiliate", "joint venture")


@dataclass(frozen=True)
class FamilyRow:
    family: str
    member_norm: str
    note: str
    source: str


def read_seed(path: Path | None = None) -> tuple[list[FamilyRow], list[str]]:
    """The seed's rows, and the lines it cannot use (a bad note, no family, no member, no source)."""
    p = path or SEED_PATH
    if not p.exists():
        return [], []
    lines = [line for line in p.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")]
    rows: list[FamilyRow] = []
    bad: list[str] = []
    for r in csv.DictReader(io.StringIO("\n".join(lines))):
        family = squash(r.get("family"))
        member = norm_name(squash(r.get("member_norm")))
        note = squash(r.get("note")).casefold()
        source = squash(r.get("source"))
        if not family or not member:
            bad.append(f"{family or '(no family)'}: {member or '(no member)'}: a family and a member are needed")
        elif note not in NOTES:
            bad.append(f"{family}: {member}: the note {note!r} is not one of {', '.join(NOTES)}")
        elif not source:
            bad.append(f"{family}: {member}: no source")
        else:
            rows.append(FamilyRow(family, member, note, source))
    return rows, bad


def _live_ids(conn: sqlite3.Connection) -> dict[str, str]:
    """Every id a seed row may name, mapped to the live organization holding its records: the live ids
    themselves, and the retired ones through their aliases."""
    from .export_static import resolve_aliases  # the export reads this stage's table; the import is one way at load

    live = {r[0]: r[0] for r in conn.execute("SELECT id FROM organizations")}
    return {**resolve_aliases(conn), **live}


def run(conn: sqlite3.Connection, *, seed_path: Path | None = None) -> dict[str, int]:
    """Rebuild organization_families from the seed; returns the counts the run log records."""
    rows, skipped = read_seed(seed_path)
    ids = _live_ids(conn)
    held: dict[str, str] = {}
    written: list[tuple[str, str, str, str]] = []
    for row in rows:
        oid = ids.get(org_id(row.member_norm))
        if oid is None:
            skipped.append(f"{row.family}: {row.member_norm}: names no organization with records")
            continue
        if oid in held:
            if held[oid] != row.family:
                skipped.append(f"{row.family}: {row.member_norm}: already a member of {held[oid]}")
            continue  # the same organization twice in one family (a member merged into another) is one member
        held[oid] = row.family
        written.append((row.family, oid, row.note, row.source))
    try:
        conn.execute("DELETE FROM organization_families")
        conn.executemany("INSERT INTO organization_families (family, organization_id, note, source) VALUES (?, ?, ?, ?)",
                         written)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    for line in skipped:
        log.info("families: skipped %s", line)
    families = len({w[0] for w in written})
    log_run(conn, "families", detail=f"families={families} members={len(written)} skipped={len(skipped)}",
            rows_in=len(rows), rows_new=len(written))
    log.info("families: %d families, %d members, %d seed rows skipped", families, len(written), len(skipped))
    return {"families": families, "members": len(written), "skipped": len(skipped)}
