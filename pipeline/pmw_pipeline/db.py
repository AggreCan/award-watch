"""SQLite helpers: open, apply the shared schema, meta values, log runs.

Organizations are written through organizations.upsert."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from . import config


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def connect(path: str | Path | None = None, *, memory: bool = False) -> sqlite3.Connection:
    if memory:
        conn = sqlite3.connect(":memory:")
    else:
        p = Path(path) if path else config.DEFAULT_DB
        p.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(p))
        conn.execute("PRAGMA journal_mode = WAL")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    apply_schema(conn)
    return conn


def apply_schema(conn: sqlite3.Connection, schema_path: Path | None = None) -> None:
    sql = (schema_path or config.SCHEMA_PATH).read_text(encoding="utf-8")
    # Columns first: an index in the schema may name a column that a database
    # from an earlier version lacks, and the script would stop there.
    add_missing_columns(conn, sql)
    conn.executescript(sql)


def add_missing_columns(conn: sqlite3.Connection, sql: str) -> list[str]:
    """Bring tables from an earlier schema up to date without a migration step.

    New tables come from the schema's CREATE TABLE IF NOT EXISTS, but a column
    added to an existing table would not, and the first query naming it would
    stop the run. The schema is built in memory and every column missing from
    the database is added with its type and default. A key column cannot be
    added this way and is left for a deliberate migration; a NOT NULL column
    with no default is added as nullable. Returns the columns added.
    """
    added: list[str] = []
    ref = sqlite3.connect(":memory:")
    try:
        ref.executescript(sql)
        tables = [r[0] for r in ref.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
        for table in tables:
            have = {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}
            if not have:
                continue  # not there yet; the schema script creates it whole
            for _cid, name, ctype, notnull, default, pk in ref.execute(f'PRAGMA table_info("{table}")'):
                if name in have or pk:
                    continue
                clause = f'ALTER TABLE "{table}" ADD COLUMN "{name}" {ctype or ""}'.rstrip()
                if default is not None:
                    clause += f" DEFAULT {default}"
                    if notnull:
                        clause += " NOT NULL"
                conn.execute(clause)
                added.append(f"{table}.{name}")
        if added:
            conn.commit()
    finally:
        ref.close()
    return added


def set_meta(conn: sqlite3.Connection, key: str, value: object) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )


def get_meta(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def hours_since(conn: sqlite3.Connection, key: str, *, now: str | None = None) -> float | None:
    """Hours since the ISO datetime stored under a meta key; None when unset or unparseable."""
    value = get_meta(conn, key)
    if not value:
        return None
    try:
        then = datetime.fromisoformat(value.replace("Z", "+00:00"))
        current = datetime.fromisoformat((now or now_iso()).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (current - then).total_seconds() / 3600.0


# A stage's notices share one log row, joined by " | ", up to this many
# characters.
NOTICE_MAX_CHARS = 3000


def log_run(
    conn: sqlite3.Connection,
    source: str,
    *,
    detail: str = "",
    rows_in: int = 0,
    rows_new: int = 0,
    excluded: int = 0,
    ok: bool = True,
    notice: str | None = None,
) -> None:
    """One row of the run log. ok=False is a failed stage (the run status is not
    ok, a retry trigger runs the refresh again, and it is an item needing
    attention). notice is information a retry would not change (a buyer
    spelling the seed does not cover yet, a file not published yet, a stage
    not built): status.json's notices, LAST_RUN.md and the daily check's
    email, never an item needing attention; the run stays ok."""
    conn.execute(
        "INSERT INTO sources_log (run_at, source, detail, rows_in, rows_new, excluded, ok, notice) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (now_iso(), source, detail, rows_in, rows_new, excluded, 1 if ok else 0, (notice or "")[:NOTICE_MAX_CHARS] or None),
    )
    conn.commit()
