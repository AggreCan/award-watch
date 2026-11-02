"""The hosted search database: its rows, and the nightly sync that keeps it current.

The search database (D1 `awardwatch-search`, binding SEARCH, schema in
pipeline/search_schema.sql) answers the site's /search page. It holds one row
per organization and one per buyer with a page, each with the names a reader
may type: an organization's display name, every other spelling its records
carry (organization_names) and its business numbers; a buyer's English and
French names, its acronyms, every spelling the sources use (buyer_names) and
the buyer ids retired into it (buyers/aliases.json). Beside the names go the
figures the result lists show: the province or directory code, the record
count per source and the per-source totals. Records themselves are not
searched.

Aliases. An organization merged into another, or retired by a normalization
change, is a row of organization_aliases (old id -> live id). Its records
move to the live organization, so its spellings are among the live one's
organization_names and find it here; a name the alias table carries of its
own (_alias_names) is added beside them. A retired buyer id (buyer_aliases,
exported with chains followed as buyers/aliases.json) is indexed as a
spelling of the buyer it leads to, and the retired buyer's own spellings
already map to that buyer in buyer_names.

Organizations come from the database (the organizations row is what the
profile shows). Buyers come from the export's buyers/index.json, the file the
/buyers page renders, because that file names exactly the buyers that have a
page and carries the history totals the export computes; the sync therefore
runs after the export.

Why a ledger: sending every row each night would cost a few million row
writes for a dataset that changes by a few thousand rows a day. The table
search_ledger (schema.sql) records the key and hash of every row as last
confirmed in D1, and tonight's rows are compared with it:

  plan_sync      the upserts (a new key, or a hash that changed) and the
                 deletes (a key the ledger holds that tonight's rows lack)
  write_batches  SQL files of at most MAX_BATCH_BYTES or MAX_BATCH_STATEMENTS
                 each (up to MAX_ROWS_PER_UPSERT rows per upsert,
                 MAX_KEYS_PER_DELETE ids per delete, MAX_STATEMENT_BYTES per
                 statement), plus manifest.json: the files in order, the
                 counts, the rows each table must hold afterwards, and the
                 ledger entries to record
  record_sync    applies those entries. The workflow calls it (search-synced)
                 only after every batch applied and the row counts read back
                 from D1 matched the manifest (search-check)

Nothing else writes the ledger, so a night that failed part way leaves it as
it was and the next night sends the same changes again; every statement in a
batch gives the same result when applied twice.

A full reload drops the tables, applies the schema again and sends every
row. `search-sync --full` asks for one. The sync makes one by itself on an
empty ledger (the first load, or a database restored without its ledger) and
after the counts read back from D1 disagreed with the manifest (search-check
notes the date in meta), but not within RELOAD_MIN_DAYS of the last one, so a
fault that keeps a count wrong cannot reload every night. A row applied on a
night whose later batch failed, then gone from the data before the retry, is
in D1 but never in the ledger, so no night would delete it; the counts catch
it and a full reload removes it.

No value here comes from a visitor (the rows are pipeline data), but each is
still written as a literal no content can break out of; see sql_literal.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import re
import sqlite3
import unicodedata
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import date
from itertools import groupby
from pathlib import Path

from . import config
from .db import connect, get_meta, now_iso, set_meta, today_iso
from .directory import code_for
from .export_static import BUYER_ID_RE, ORG_ID_RE, resolve_aliases
from .normalize import business_number

log = logging.getLogger(__name__)

SCHEMA_PATH = config.REPO_ROOT / "pipeline" / "search_schema.sql"


@dataclass(frozen=True)
class Table:
    prefix: str             # the ledger key's prefix: 'o' or 'b'
    name: str               # the D1 table
    columns: tuple[str, ...]  # every column the sync writes, in the order the hash reads them, without the hash

    @property
    def written(self) -> tuple[str, ...]:
        return self.columns + ("hash",)


# Changing a column list or its order changes every hash of that table, which
# resends each of its rows once.
ORGS = Table("o", "search_orgs", (
    "id", "name", "alt", "bn", "folds", "prov", "city",
    "n_awards", "n_history", "n_contracts", "n_grants", "n_lobbying", "n_records",
    "total_awards", "total_history", "total_contracts", "total_grants",
))
BUYERS = Table("b", "search_buyers", (
    "id", "name", "name_fr", "acronym_en", "acronym_fr", "alt", "folds", "kind",
    "n_tenders", "n_open_tenders", "n_awards", "n_history", "n_contracts", "n_grants", "n_records",
    "total_awards", "total_history", "total_contracts", "total_grants",
))
TABLES = (ORGS, BUYERS)
BY_PREFIX = {t.prefix: t for t in TABLES}
BY_NAME = {t.name: t for t in TABLES}

# The spellings kept beside a name: the most frequent first, up to this many
# and this many characters in all, so one organization with hundreds of
# vendor-name variants cannot make a row too large for a statement.
MAX_SPELLINGS = 40
MAX_ALT_CHARS = 4000
MAX_NUMBERS = 10

# D1 runs each batch file as one import; these keep a file small enough to
# upload and apply in seconds, and a failed one cheap to retry.
MAX_BATCH_BYTES = 5_000_000
MAX_BATCH_STATEMENTS = 5_000
# Rows go several to a statement, since the ON CONFLICT clause is longer than
# a row and is written once per statement. D1 refuses a statement above
# 100,000 bytes, so a statement stays under 64 KiB whatever the names hold.
MAX_ROWS_PER_UPSERT = 100
MAX_KEYS_PER_DELETE = 500
MAX_STATEMENT_BYTES = 64 * 1024
# A full reload writes about as many rows as months of nights, so one forced
# by a count that disagreed is not repeated within this many days.
RELOAD_MIN_DAYS = 7

META_RELOAD = "search_reload_due"       # the date search-check found a count disagreeing
META_FULL_AT = "search_full_at"         # the date the last full reload was written
MANIFEST = "manifest.json"
BATCH_LIST = "batches.txt"              # the batch files in order, one per line, for the workflow's loop
OUTCOME = "last_outcome.txt"            # under data/out/search, read by `nightly status`

COMMANDS = ("search-sync", "search-check", "search-synced")

_INT64 = (-(2 ** 63), 2 ** 63 - 1)
_NOT_WORD = re.compile(r"[\W_]+")


# -- folding -----------------------------------------------------------------


def fold(text: str | None) -> str:
    """Lower case, accents and punctuation removed, words separated by one space.

    site/src/search_db.ts foldText does the same to the query (NFD, combining
    marks removed, lower case, every run of characters that are neither
    letters nor digits made one space), so an exact or leading match compares
    like with like. "Ferme Éloïse Québec Inc." -> "ferme eloise quebec inc".
    """
    t = unicodedata.normalize("NFD", text or "")
    t = "".join(ch for ch in t if not unicodedata.category(ch).startswith("M")).lower()
    return _NOT_WORD.sub(" ", t).strip()


def spelling_list(display: str, spellings: Iterable[str], *, max_items: int = MAX_SPELLINGS,
                  max_chars: int = MAX_ALT_CHARS) -> list[str]:
    """The spellings to index beside a display name, in the order given.

    Two spellings that fold alike are the same words to the index, so only
    the first is kept, and one that folds like the display name is left out.
    A line break inside a spelling would split it in two, so white space is
    made single spaces.
    """
    seen = {fold(display)}
    out: list[str] = []
    size = 0
    for raw in spellings:
        text = re.sub(r"\s+", " ", raw or "").strip()
        key = fold(text)
        if not key or key in seen:
            continue
        if len(out) >= max_items or size + len(text) + 1 > max_chars:
            break
        seen.add(key)
        out.append(text)
        size += len(text) + 1
    return out


# -- the rows ----------------------------------------------------------------


def _alias_names(conn: sqlite3.Connection) -> dict[str, list[str]]:
    """Names recorded for retired or merged organization ids, by the live id they lead to.

    organization_aliases maps an old id to the id that took its records. When
    the table carries a name for the old id (a column named name, alias,
    alias_name, old_name, display_name or raw_name), that name finds the live
    organization. Without one there is nothing to add: the old id's records,
    and so its spellings, already sit under the live id.
    """
    columns = {r[1] for r in conn.execute("PRAGMA table_info(organization_aliases)")}
    named = [c for c in ("name", "alias", "alias_name", "old_name", "display_name", "raw_name") if c in columns]
    if not named:
        return {}
    live = resolve_aliases(conn)
    out: dict[str, list[str]] = {}
    for row in conn.execute(f"SELECT old_id, {', '.join(named)} FROM organization_aliases ORDER BY old_id"):
        target = live.get(row[0])
        if not target:
            continue
        for value in row[1:]:
            if isinstance(value, str) and value.strip():
                out.setdefault(target, []).append(value)
    return out


def _business_numbers(conn: sqlite3.Connection) -> dict[str, set[str]]:
    """Every valid business number a source carries for an organization.

    The grants rows (each agreement's recipient number), the organizations
    row's own (the one every grant agrees on) and the federal corporations
    extract's, through an exact registry match only: a probable match could
    be another business.
    """
    out: dict[str, set[str]] = {}
    queries = [
        "SELECT DISTINCT organization_id, business_number FROM grants "
        "WHERE organization_id IS NOT NULL AND business_number IS NOT NULL AND business_number != ''",
        "SELECT id, business_number FROM organizations WHERE business_number IS NOT NULL",
        "SELECT m.organization_id, f.business_number FROM registry_matches m "
        "JOIN federal_corporations f ON f.number = m.registry_id "
        "WHERE m.registry = 'corporations_canada' AND m.grade = 'exact' AND f.business_number IS NOT NULL",
    ]
    for sql in queries:
        for oid, raw in conn.execute(sql):
            bn = business_number(raw)
            if bn:
                out.setdefault(oid, set()).add(bn)
    return out


def _count(value: object) -> int:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _money(value: object) -> float | None:
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    v = round(float(value), 2)
    return v if math.isfinite(v) else None


def _text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    t = re.sub(r"\s+", " ", value).strip()
    return t or None


def org_rows(conn: sqlite3.Connection) -> Iterator[dict]:
    """One search row per organization, in id order."""
    numbers = _business_numbers(conn)
    aliases = _alias_names(conn)
    names = conn.execute(
        "SELECT organization_id, raw_name, SUM(n) AS n FROM organization_names "
        "GROUP BY organization_id, raw_name ORDER BY organization_id, n DESC, raw_name")
    grouped = groupby(names, key=lambda r: r[0])
    pending = next(grouped, None)
    for o in conn.execute(
            "SELECT id, display_name, country, province, city, n_awards, n_history, n_contracts, n_grants, n_lobbying, "
            "total_awards, total_history, total_contracts, total_grants FROM organizations ORDER BY id"):
        oid = o[0]
        if not isinstance(oid, str) or not ORG_ID_RE.match(oid):
            log.warning("search: organization id %r is not an id the site serves; left out", oid)
            continue
        # Both cursors run in id order, so the spellings of the ids before
        # this one are passed over and this one's taken when they are next.
        spellings: list[str] = []
        while pending is not None and pending[0] < oid:
            pending = next(grouped, None)
        if pending is not None and pending[0] == oid:
            spellings = [r[1] for r in pending[1]]
            pending = next(grouped, None)
        display = _text(o[1]) or oid
        counts = [_count(v) for v in o[5:10]]
        yield {
            "id": oid,
            "name": display,
            "alt": "\n".join(spelling_list(display, [*spellings, *aliases.get(oid, [])])),
            "bn": " ".join(sorted(numbers.get(oid, set()))[:MAX_NUMBERS]),
            "folds": fold(display),
            "prov": code_for(o[2], o[3]).upper(),
            "city": _text(o[4]),
            "n_awards": counts[0], "n_history": counts[1], "n_contracts": counts[2], "n_grants": counts[3],
            "n_lobbying": counts[4], "n_records": sum(counts),
            "total_awards": _money(o[10]), "total_history": _money(o[11]),
            "total_contracts": _money(o[12]), "total_grants": _money(o[13]),
        }


def read_buyer_aliases(static_dir: Path) -> dict[str, list[str]]:
    """Retired buyer ids by the listed buyer each leads to, from the export's buyers/aliases.json.

    The export writes {"aliases": {old id: listed id}} with chains followed
    and only aliases whose target has a page. An export without the file (one
    written before buyer aliases existed) has none; a file of the wrong shape
    raises.
    """
    path = static_dir / "buyers" / "aliases.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    aliases = data.get("aliases") if isinstance(data, dict) else None
    if not isinstance(aliases, dict):
        raise ValueError(f"{path} holds no aliases object")
    out: dict[str, list[str]] = {}
    for old, new in sorted(aliases.items()):
        if isinstance(old, str) and isinstance(new, str) and BUYER_ID_RE.match(old) and old != new:
            out.setdefault(new, []).append(old)
    return out


def read_buyer_index(static_dir: Path) -> list[dict]:
    """The buyers of the export's buyers/index.json, each checked; a file that is missing or the wrong shape raises."""
    path = static_dir / "buyers" / "index.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    buyers = data.get("buyers") if isinstance(data, dict) else None
    if not isinstance(buyers, list):
        raise ValueError(f"{path} holds no buyers list")
    return [b for b in buyers if isinstance(b, dict)]


def buyer_rows(conn: sqlite3.Connection, static_dir: Path) -> Iterator[dict]:
    """One search row per buyer with a page, in id order."""
    spellings: dict[str, list[str]] = {}
    for bid, raw in conn.execute("SELECT buyer_id, raw_name FROM buyer_names ORDER BY buyer_id, raw_name"):
        spellings.setdefault(bid, []).append(raw)
    retired = read_buyer_aliases(static_dir)
    rows = []
    for b in read_buyer_index(static_dir):
        bid = b.get("id")
        name = _text(b.get("name_en"))
        if not isinstance(bid, str) or not BUYER_ID_RE.match(bid) or len(bid) > 80 or not name:
            log.warning("search: buyer %r is not one the site serves; left out", bid)
            continue
        name_fr = _text(b.get("name_fr"))
        acronyms = [a for a in (_text(b.get("acronym_en")), _text(b.get("acronym_fr"))) if a]
        primary = [name, *(x for x in (name_fr, *acronyms) if x)]
        # The retired ids come before the spellings, so the cap drops a spelling before a retired id.
        alt = spelling_list(name, [*primary[1:], *retired.get(bid, []), *spellings.get(bid, [])])
        counts = [_count(b.get(k)) for k in ("n_tenders", "n_open_tenders", "n_awards", "n_history", "n_contracts", "n_grants")]
        folds: list[str] = []
        for p in primary:
            f = fold(p)
            if f and f not in folds:
                folds.append(f)
        rows.append({
            "id": bid,
            "name": name,
            "name_fr": name_fr,
            "acronym_en": _text(b.get("acronym_en")),
            "acronym_fr": _text(b.get("acronym_fr")),
            # The French name is a column of the index of its own; the rest
            # (acronyms, other spellings) go in alt.
            "alt": "\n".join(s for s in alt if s != name_fr),
            "folds": "\n".join(folds),
            "kind": _text(b.get("kind")),
            "n_tenders": counts[0], "n_open_tenders": counts[1], "n_awards": counts[2], "n_history": counts[3],
            "n_contracts": counts[4], "n_grants": counts[5],
            "n_records": counts[0] + sum(counts[2:]),
            "total_awards": _money(b.get("total_awards")), "total_history": _money(b.get("total_history")),
            "total_contracts": _money(b.get("total_contracts")), "total_grants": _money(b.get("total_grants")),
        })
    yield from sorted(rows, key=lambda r: r["id"])


def search_rows(conn: sqlite3.Connection, static_dir: Path) -> Iterator[tuple[Table, dict]]:
    """Every row of the search database with its table: the organizations, then the buyers."""
    for row in org_rows(conn):
        yield ORGS, row
    for row in buyer_rows(conn, static_dir):
        yield BUYERS, row


def row_hash(table: Table, row: dict) -> str:
    """A 64-bit BLAKE2b over the row's values in the table's column order, as hex.

    JSON keeps None, "" and 0 apart and writes each number one way, so the
    hash changes exactly when a value does. The hash only tells the sync what
    changed; 64 bits keep the ledger small, and a change that kept its hash
    would need two values to collide one in 2**64.
    """
    payload = json.dumps([table.name, *(row[c] for c in table.columns)], ensure_ascii=False,
                         separators=(",", ":"), allow_nan=False)
    return hashlib.blake2b(payload.encode("utf-8"), digest_size=8).hexdigest()


# -- the plan ----------------------------------------------------------------


@dataclass
class SyncPlan:
    upserts: dict[str, list[tuple]]     # table -> rows, values in Table.written order (the hash last)
    deletes: dict[str, list[str]]       # table -> ids
    record: list[tuple[str, str]]       # ledger entries to write once D1 holds the plan: (key, hash)
    forget: list[str]                   # ledger keys to remove once D1 holds the plan
    totals: dict[str, int]              # table -> rows it holds once the plan is applied
    full: bool = False
    reason: str = ""                    # why a full reload, when it is one
    left_out: int = 0                   # ledger keys of no known table (removed from the ledger only)


def _days_between(earlier: str, later: str) -> int | None:
    try:
        return (date.fromisoformat(later[:10]) - date.fromisoformat(earlier[:10])).days
    except ValueError:
        return None


def full_reason(conn: sqlite3.Connection, *, requested: bool = False, ledger_empty: bool = False,
                today: str | None = None) -> str:
    """Why tonight's sync is a full reload, or "" when it is not."""
    if requested:
        return "requested"
    due = get_meta(conn, META_RELOAD)
    if ledger_empty:
        why = "first load (the ledger is empty)"
    elif due:
        why = f"the row counts read back from D1 disagreed on {due}"
    else:
        return ""
    last = get_meta(conn, META_FULL_AT)
    days = _days_between(last, today or today_iso()) if last else None
    return why if days is None or days >= RELOAD_MIN_DAYS else ""


def plan_sync(conn: sqlite3.Connection, static_dir: Path, *, full: bool = False, today: str | None = None) -> SyncPlan:
    """Compare tonight's rows with the ledger: what to upsert, what to delete."""
    ledger = {key: h for key, h in conn.execute("SELECT key, hash FROM search_ledger")}
    reason = full_reason(conn, requested=full, ledger_empty=not ledger, today=today)
    upserts: dict[str, list[tuple]] = {t.name: [] for t in TABLES}
    totals = {t.name: 0 for t in TABLES}
    record: list[tuple[str, str]] = []
    seen: set[str] = set()
    for table, row in search_rows(conn, static_dir):
        key = f"{table.prefix}:{row['id']}"
        if key in seen:
            raise ValueError(f"search row {key} appears twice")
        seen.add(key)
        h = row_hash(table, row)
        totals[table.name] += 1
        # Popped, so what is left afterwards is the keys tonight's rows lack.
        old = ledger.pop(key, None)
        if reason or old != h:
            upserts[table.name].append(tuple(row[c] for c in table.columns) + (h,))
            record.append((key, h))
    deletes: dict[str, list[str]] = {t.name: [] for t in TABLES}
    left_out = 0
    forget: list[str] = []
    # A full reload starts from empty tables and replaces the whole ledger, so
    # it deletes nothing by key.
    if not reason:
        for key in sorted(ledger):
            prefix, _, ident = key.partition(":")
            table = BY_PREFIX.get(prefix)
            if table is None or not ident:
                left_out += 1
            else:
                deletes[table.name].append(ident)
            forget.append(key)
    return SyncPlan(upserts=upserts, deletes=deletes, record=record, forget=forget, totals=totals,
                    full=bool(reason), reason=reason, left_out=left_out)


# -- the batch files ---------------------------------------------------------


def sql_literal(value: object) -> str:
    """value as an SQL literal for a statement in a batch file.

    A batch is a text file D1 runs as it stands, so nothing can be bound as a
    parameter; each value is written in the one form SQLite reads back as
    exactly that value. Text is quoted with every single quote doubled, the
    only escape inside an SQL string (a backslash, a semicolon, a newline or
    `--` there is an ordinary character), so no content can end the string
    early. A NUL byte cannot be carried in SQL text (the parser stops at it),
    so text holding one is refused rather than quietly changed.
    """
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        if not _INT64[0] <= value <= _INT64[1]:
            raise ValueError(f"{value} is outside SQLite's 64-bit integer range")
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"{value!r} has no SQL literal")
        return repr(value)
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError(f"text holds a NUL byte, which SQL text cannot carry: {value[:60]!r}")
        return "'" + value.replace("'", "''") + "'"
    raise TypeError(f"no SQL literal for a {type(value).__name__}")


def _upsert_head(table: Table) -> str:
    return f"INSERT INTO {table.name} ({', '.join(table.written)}) VALUES "


# INSERT ... ON CONFLICT DO UPDATE rather than INSERT OR REPLACE: REPLACE
# deletes the old row without firing the delete trigger (unless recursive
# triggers are on), and the full-text index would keep the old names. The
# WHERE makes a row already carrying tonight's hash cost no write when a
# batch is applied again. rid is never written: a new row takes the next one
# and an updated row keeps its own, which is all the index needs.
def _upsert_tail(table: Table) -> str:
    sets = ", ".join(f"{c} = excluded.{c}" for c in table.written if c != "id")
    return f" ON CONFLICT (id) DO UPDATE SET {sets} WHERE {table.name}.hash IS NOT excluded.hash;"


def row_tuple(table: Table, values: Sequence) -> str:
    """One row's values (Table.written order) as a parenthesised list of literals."""
    if len(values) != len(table.written):
        raise ValueError(f"a {table.name} row has {len(table.written)} values, not {len(values)}")
    parts = []
    for column, value in zip(table.written, values):
        try:
            parts.append(sql_literal(value))
        except (ValueError, TypeError) as exc:
            raise ValueError(f"{table.name} row {values[0]!r}, column {column}: {exc}") from None
    return "(" + ", ".join(parts) + ")"


def _grouped(items: Sequence, render, head: str, tail: str, max_items: int, max_bytes: int,
             what) -> Iterator[str]:
    """head + rendered items joined by ", " + tail, as few statements as the caps allow.

    Each statement holds at most max_items items and at most max_bytes bytes
    of UTF-8; an item too long for a statement of its own is refused, named.
    """
    fixed = len(head.encode("utf-8")) + len(tail.encode("utf-8"))
    sep = 2  # ", "
    chunk: list[str] = []
    size = fixed
    for item in items:
        text = render(item)
        try:
            n = len(text.encode("utf-8"))
        except UnicodeEncodeError as exc:
            raise ValueError(f"{what(item)}: the text is not valid Unicode ({exc.reason})") from None
        if fixed + n > max_bytes:
            raise ValueError(f"{what(item)}: {fixed + n} bytes as a statement of its own, over the "
                             f"{max_bytes}-byte statement limit")
        if chunk and (len(chunk) >= max_items or size + sep + n > max_bytes):
            yield head + ", ".join(chunk) + tail
            chunk, size = [], fixed
        size += (sep if chunk else 0) + n
        chunk.append(text)
    if chunk:
        yield head + ", ".join(chunk) + tail


def upsert_statements(table: Table, rows: Sequence[Sequence], *, max_rows: int = MAX_ROWS_PER_UPSERT,
                      max_bytes: int = MAX_STATEMENT_BYTES) -> Iterator[str]:
    """The rows as multi-row upserts, each within max_rows and max_bytes."""
    return _grouped(rows, lambda v: row_tuple(table, v), _upsert_head(table), _upsert_tail(table), max_rows, max_bytes,
                    lambda v: f"{table.name} row {v[0]!r}")


def delete_statements(table: Table, ids: Sequence[str], *, max_keys: int = MAX_KEYS_PER_DELETE,
                      max_bytes: int = MAX_STATEMENT_BYTES) -> Iterator[str]:
    """The ids as DELETE ... WHERE id IN (...) statements, each within max_keys and max_bytes."""
    return _grouped(ids, sql_literal, f"DELETE FROM {table.name} WHERE id IN (", ");", max_keys, max_bytes,
                    lambda k: f"{table.name} delete {k!r}")


# The first batch of a full reload. Dropping the tables takes their triggers
# with them and costs no per-row work, where a DELETE would fire the index
# trigger once per row; the schema then creates them as written today, so a
# changed column or tokenizer reaches D1 this way.
def reset_sql(schema_path: Path | None = None) -> str:
    drops = "".join(f"DROP TABLE IF EXISTS {t.name}_fts;\nDROP TABLE IF EXISTS {t.name};\n" for t in TABLES)
    return ("-- Full reload: drop the search tables and create them again from search_schema.sql.\n" + drops
            + (schema_path or SCHEMA_PATH).read_text(encoding="utf-8"))


class _BatchWriter:
    """Fills batch-0001.sql, batch-0002.sql and so on, each within both caps."""

    def __init__(self, out_dir: Path, max_bytes: int, max_statements: int) -> None:
        self.out_dir = out_dir
        self.max_bytes = max_bytes
        self.max_statements = max_statements
        self.files: list[str] = []
        self.bytes = 0
        self.statements = 0
        self._parts: list[bytes] = []
        self._size = 0

    def add(self, statement: str, label: str) -> None:
        try:
            data = statement.encode("utf-8") + b"\n"
        except UnicodeEncodeError as exc:
            raise ValueError(f"{label}: the text is not valid Unicode ({exc.reason})") from None
        if len(data) > self.max_bytes:
            raise ValueError(f"{label}: one statement of {len(data)} bytes is over the {self.max_bytes}-byte batch limit")
        if self._parts and (self._size + len(data) > self.max_bytes or len(self._parts) >= self.max_statements):
            self.flush()
        self._parts.append(data)
        self._size += len(data)
        self.statements += 1

    def flush(self) -> None:
        if not self._parts:
            return
        name = f"batch-{len(self.files) + 1:04d}.sql"
        # Bytes, not text mode: Windows would write a newline inside a name as
        # CRLF and change the value.
        (self.out_dir / name).write_bytes(b"".join(self._parts))
        self.files.append(name)
        self.bytes += self._size
        self._parts = []
        self._size = 0


def write_batches(plan: SyncPlan, out_dir: Path, *, max_bytes: int = MAX_BATCH_BYTES,
                  max_statements: int = MAX_BATCH_STATEMENTS, max_rows_per_upsert: int = MAX_ROWS_PER_UPSERT,
                  max_keys_per_delete: int = MAX_KEYS_PER_DELETE, max_statement_bytes: int = MAX_STATEMENT_BYTES,
                  schema_path: Path | None = None) -> dict:
    """Write the plan as batch files, batches.txt and manifest.json under out_dir; return the manifest.

    The reset of a full reload is a batch of its own and comes first; then the
    deletes, then the upserts. The manifest is written last and in one step,
    so a manifest on disk always names batches that were written in full.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("batch-*.sql"):
        old.unlink()
    for name in (MANIFEST, BATCH_LIST):
        (out_dir / name).unlink(missing_ok=True)
    writer = _BatchWriter(out_dir, max_bytes, max_statements)
    if plan.full:
        writer.add(reset_sql(schema_path), "the reset batch")
        writer.flush()
    for table in TABLES:
        for statement in delete_statements(table, plan.deletes[table.name], max_keys=max_keys_per_delete,
                                           max_bytes=max_statement_bytes):
            writer.add(statement, f"a {table.name} delete")
    for table in TABLES:
        for statement in upsert_statements(table, plan.upserts[table.name], max_rows=max_rows_per_upsert,
                                           max_bytes=max_statement_bytes):
            writer.add(statement, f"a {table.name} upsert")
    writer.flush()
    manifest = {
        "generated_at": now_iso(),
        "full": plan.full,
        "reason": plan.reason,
        "batches": writer.files,
        "bytes": writer.bytes,
        "statements": writer.statements,
        "upserts": {name: len(rows) for name, rows in plan.upserts.items()},
        "deletes": {name: len(ids) for name, ids in plan.deletes.items()},
        "expected": dict(plan.totals),
        "expected_total": sum(plan.totals.values()),
        # What record_sync writes to the ledger once D1 holds all of this.
        "record": {"upserts": [list(e) for e in plan.record], "deletes": list(plan.forget)},
    }
    (out_dir / BATCH_LIST).write_text("".join(f"{name}\n" for name in writer.files), encoding="utf-8")
    partial = out_dir / (MANIFEST + ".partial")
    partial.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    partial.replace(out_dir / MANIFEST)
    return manifest


def sync(conn: sqlite3.Connection, out_dir: Path | None = None, *, static_dir: Path | None = None,
         full: bool = False) -> dict:
    """Plan tonight's sync and write it (the search-sync command); return the manifest.

    The date of a full reload is noted in meta, which spaces out the reloads a
    disagreeing count asks for. The ledger is not touched.
    """
    out = out_dir or (config.OUT_DIR / "search")
    # Last night's manifest must not outlive a plan that fails tonight.
    for name in (MANIFEST, BATCH_LIST):
        (out / name).unlink(missing_ok=True)
    plan = plan_sync(conn, static_dir or (config.OUT_DIR / "static"), full=full)
    manifest = write_batches(plan, out)
    if plan.full:
        set_meta(conn, META_FULL_AT, today_iso())
        conn.commit()
    return manifest


# -- after the apply ---------------------------------------------------------


def read_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("batches"), list) \
            or not isinstance(manifest.get("expected"), dict):
        raise ValueError(f"{path} is not a search sync manifest")
    return manifest


def expected_counts(manifest: dict) -> dict[str, int]:
    expected = manifest.get("expected")
    if not isinstance(expected, dict) or set(expected) != set(BY_NAME):
        raise ValueError("the manifest names no row count for each search table")
    return {name: int(expected[name]) for name in BY_NAME}


def parse_counts(text: str) -> dict[str, int]:
    """The row counts in Wrangler's JSON answer to COUNT_SQL, by table.

    `wrangler d1 execute --json --command` prints a list with one result per
    statement, its rows under "results". Anything before the list (a notice
    Wrangler printed first) is skipped.
    """
    start = text.find("[")
    if start < 0:
        raise ValueError("no JSON list in the count answer")
    data, _ = json.JSONDecoder().raw_decode(text, start)
    try:
        row = data[0]["results"][0]
        counts = {"search_orgs": row["orgs"], "search_buyers": row["buyers"]}
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError(f"the count answer is not the shape COUNT_SQL returns ({type(exc).__name__})") from None
    for name, value in counts.items():
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError(f"the count answer gives {value!r} rows for {name}")
    return counts


# The statement the workflow runs for the count check.
COUNT_SQL = "SELECT (SELECT COUNT(*) FROM search_orgs) AS orgs, (SELECT COUNT(*) FROM search_buyers) AS buyers"


def count_check(expected: dict[str, int], actual: dict[str, int]) -> str | None:
    """None when D1 holds the expected number of rows in each table, otherwise what disagrees."""
    wrong = [f"{name} holds {actual.get(name)} rows where the manifest expects {n}"
             for name, n in sorted(expected.items()) if actual.get(name) != n]
    return "; ".join(wrong) or None


def record_sync(conn: sqlite3.Connection, manifest: dict) -> dict[str, int]:
    """Write the manifest's ledger entries, once D1 holds every batch.

    A full reload replaces the whole ledger. The ledger must then hold exactly
    the manifest's expected total, which is how a manifest planned against a
    different ledger (an old file, a second database) is caught: nothing is
    recorded, and the next night sends its changes again. The sync is logged
    in search_sync, and a reload asked for earlier is no longer due.
    """
    record = manifest.get("record")
    if not isinstance(record, dict) or not isinstance(record.get("upserts"), list) \
            or not isinstance(record.get("deletes"), list):
        raise ValueError("the manifest carries no ledger entries")
    upserts = [(str(key), str(h)) for key, h in record["upserts"]]
    deletes = [(str(key),) for key in record["deletes"]]
    expected = int(manifest["expected_total"])
    summary = {k: manifest.get(k) for k in ("generated_at", "full", "reason", "bytes", "statements", "upserts",
                                            "deletes", "expected")}
    summary["batches"] = len(manifest.get("batches") or [])
    try:
        if manifest.get("full"):
            conn.execute("DELETE FROM search_ledger")
        conn.executemany(
            "INSERT INTO search_ledger (key, hash) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET hash = excluded.hash",
            upserts)
        conn.executemany("DELETE FROM search_ledger WHERE key = ?", deletes)
        held = conn.execute("SELECT COUNT(*) FROM search_ledger").fetchone()[0]
        if held != expected:
            raise ValueError(f"the ledger would hold {held} rows where the manifest expects {expected}; "
                             f"the manifest was not planned against this database's ledger")
        conn.execute("DELETE FROM meta WHERE key = ?", (META_RELOAD,))
        conn.execute("INSERT INTO search_sync (run_at, manifest, rows, full) VALUES (?, ?, ?, ?)",
                     (now_iso(), json.dumps(summary, separators=(",", ":"), sort_keys=True), held,
                      1 if manifest.get("full") else 0))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return {"recorded": len(upserts), "removed": len(deletes), "ledger": held}


def request_reload(conn: sqlite3.Connection, when: str | None = None) -> None:
    """Note that a count disagreed, so a coming sync reloads in full (see full_reason)."""
    set_meta(conn, META_RELOAD, when or today_iso())
    conn.commit()


# -- the commands ------------------------------------------------------------


def add_parsers(sub: argparse._SubParsersAction) -> None:
    """search-sync writes the batches, the workflow applies them with Wrangler and
    reads the row counts back, search-check compares them, and only then
    search-synced records the ledger (docs/hosted-search.md)."""
    ss = sub.add_parser("search-sync", help="write the search database's changed rows as SQL batches and a manifest")
    ss.add_argument("--db", default=None, help="SQLite path (default data/awardwatch.sqlite)")
    ss.add_argument("--static", default=None, help="the static export, for buyers/index.json (default data/out/static)")
    ss.add_argument("--out", default=None, help="folder for the batches and manifest.json (default data/out/search)")
    ss.add_argument("--full", action="store_true", help="a full reload: drop and recreate the tables, then send every row")
    sc = sub.add_parser("search-check", help="compare the row counts read back from D1 with the manifest")
    sc.add_argument("--manifest", required=True)
    sc.add_argument("--counts", required=True, help="Wrangler's --json answer to the count statement (COUNT_SQL)")
    sc.add_argument("--db", default=None,
                    help="SQLite path; when given, a mismatch is noted there so a coming sync reloads in full")
    sd = sub.add_parser("search-synced", help="record the ledger entries of a manifest whose batches were all applied")
    sd.add_argument("--db", default=None, help="SQLite path (default data/awardwatch.sqlite)")
    sd.add_argument("--manifest", required=True)


def _outcome(outcome: str) -> None:
    out = config.OUT_DIR / "search"
    out.mkdir(parents=True, exist_ok=True)
    (out / OUTCOME).write_text(outcome + "\n", encoding="utf-8")


def command(args: argparse.Namespace) -> int:
    """Run one of COMMANDS. 0 on success; 1 when the counts disagree."""
    if args.command == "search-check":
        return _check(args)
    # "failed" is written first and replaced only by search-synced, the last
    # command of the sync, so a night that stops anywhere in between (a batch
    # Wrangler could not apply, a count that disagrees, the step's time
    # limit) reads as failed in the run status.
    if args.command == "search-sync":
        _outcome("failed")
    conn = connect(args.db)
    try:
        if args.command == "search-sync":
            manifest = sync(conn, Path(args.out) if args.out else None,
                            static_dir=Path(args.static) if args.static else None, full=args.full)
            kind = f"full reload ({manifest['reason']})" if manifest["full"] else "changes only"
            summary = (f"search-sync: {kind}: upserts {manifest['upserts']}, deletes {manifest['deletes']}, "
                       f"{len(manifest['batches'])} batches, {manifest['bytes']} bytes, "
                       f"{manifest['statements']} statements, rows expected afterwards {manifest['expected']}")
            log.info("%s", summary)
            print(summary)
            return 0
        manifest = read_manifest(Path(args.manifest))
        counts = record_sync(conn, manifest)
        outcome = "synced" if manifest["batches"] else "nothing to send"
        log.info("search-synced: %s, ledger %s", outcome, counts)
        _outcome(outcome)
        return 0
    finally:
        conn.close()


def _check(args: argparse.Namespace) -> int:
    """Exit 1 when D1's row counts differ from the manifest's.

    The workflow then leaves the ledger unrecorded, so the next night sends
    the same changes again; with --db the mismatch is also noted, so a coming
    sync reloads in full, which removes rows a resend cannot.
    """
    manifest = read_manifest(Path(args.manifest))
    actual = parse_counts(Path(args.counts).read_text(encoding="utf-8"))
    problem = count_check(expected_counts(manifest), actual)
    if problem is None:
        log.info("search-check: %s, as the manifest expects", actual)
        print(f"search-check: {actual}, as the manifest expects")
        return 0
    log.error("search-check: %s", problem)
    if args.db:
        conn = connect(args.db)
        try:
            request_reload(conn)
        finally:
            conn.close()
    return 1
