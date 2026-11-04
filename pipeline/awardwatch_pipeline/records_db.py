"""The records database: its rows, and the nightly sync that keeps it current.

The records database (D1 `awardwatch-records`, binding RECORDS, schema in
pipeline/records_schema.sql, docs/analytics.md) answers the site's analytics
views. It holds one row per counted record of the four money sources, as
indicators.RECORDS counts them (an award notice or a PSPC history contract by
reference, valued on its newest amendment; a published contract row; a grant
or contribution agreement on its highest amendment), reduced to integers: the
source, the federal fiscal year and quarter, the buyer, the organization, the
UNSPSC segment, the counted value in cents and why a value is not counted,
whether the record was competitive and the method's code. Beside them go the
names the top lists show (rec_orgs, rec_buyers) and two summary tables the
first charts and the free views read (rec_buyer_quarters, rec_segment_years).
Grants whose recipient reads as a person are left out entirely.

The sync is the search sync's (search_db.py) with three changes, because the
records table is about a hundred times larger:

* tonight's rows are built into temporary tables and compared with the
  ledger (records_ledger) in SQL, so the three million keys never sit in a
  Python dict;
* the differences are staged in records_staged rather than written into the
  manifest, which would run to a hundred megabytes on a first load; the
  manifest carries a plan number that records-synced holds against the
  stage;
* a full reload sets rec_meta.state to 'loading' in its first batch, and the
  night's finish.sql, applied only after the counts read back matched, sets
  it to 'ready' with the data date, so a page never shows half a load.

A full reload is made on an empty ledger, when asked (`records-sync --full`)
and after a count read back disagreed, but not within RELOAD_MIN_DAYS of the
last one: a full load writes about ten million rows and index entries.

No value here comes from a visitor, and each is written as a literal no
content can break out of (search_db.sql_literal).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import re
import secrets
import sqlite3
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from . import config, organizations
from .db import connect, get_meta, now_iso, set_meta, today_iso
from .export_static import BUYER_ID_RE, ORG_ID_RE, read_segments
from .indicators import RULES_VERSION
from .search_db import (
    MAX_BATCH_BYTES, MAX_BATCH_STATEMENTS, MAX_KEYS_PER_DELETE, MAX_STATEMENT_BYTES, _BatchWriter, _grouped, sql_literal,
)

log = logging.getLogger(__name__)

SCHEMA_PATH = config.REPO_ROOT / "pipeline" / "records_schema.sql"


@dataclass(frozen=True)
class Table:
    code: int                   # the ledger's t: never renumbered, or every ledger row of the table is lost
    name: str                   # the D1 table
    key: str                    # its INTEGER PRIMARY KEY
    columns: tuple[str, ...]    # every other column the sync writes, in the order the hash reads them

    @property
    def written(self) -> tuple[str, ...]:
        return (self.key, *self.columns)


# Changing a column list or its order changes every hash of that table, which
# resends each of its rows once.
RECORDS = Table(1, "records", "k", ("src", "fy", "fq", "bid", "oid", "sid", "extra", "cents", "vnote", "comp", "meth"))
ORGS = Table(2, "rec_orgs", "oid", ("name",))
BUYERS = Table(3, "rec_buyers", "bid", ("id", "name_en", "name_fr"))
BUYER_QUARTERS = Table(4, "rec_buyer_quarters", "k", ("bid", "src", "fy", "fq", "n", "cents", "n_no_value"))
SEGMENT_YEARS = Table(5, "rec_segment_years", "k", ("sid", "src", "fy", "n", "cents", "n_no_value", "n_buyers", "n_orgs"))
TABLES = (RECORDS, ORGS, BUYERS, BUYER_QUARTERS, SEGMENT_YEARS)
BY_CODE = {t.code: t for t in TABLES}

# The source numbers the site's records_db.ts SOURCE_NUMBER repeats.
SOURCES = {"awards": 1, "history": 2, "contracts": 3, "grants": 4}

# Why a record's value is not in its cents (records.vnote).
COUNTED, NO_VALUE, OTHER_CURRENCY, FLAGGED = 0, 1, 2, 3

# A records row is about 90 bytes of SQL, so a statement holds more of them
# than a search row; 500 stay well under MAX_STATEMENT_BYTES.
MAX_ROWS_PER_UPSERT = 500
# A full load writes about ten million rows and index entries, a fifth of the
# plan's monthly allowance, so one forced by a count that disagreed waits this
# long after the last.
RELOAD_MIN_DAYS = 28

META_RELOAD = "records_reload_due"      # the date records-check found a count disagreeing
META_FULL_AT = "records_full_at"        # the date the last full reload was written
META_PLAN = "records_plan"              # the plan number of the stage records-synced may record
MANIFEST = "manifest.json"
BATCH_LIST = "batches.txt"
FINISH = "finish.sql"                   # applied after the count check: state ready, the data date
OUTCOME = "last_outcome.txt"            # under data/out/records, read by `nightly status`

COMMANDS = ("records-sync", "records-check", "records-synced")

_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


# -- keys, numbers and hashes --------------------------------------------------


def key_of(text: str) -> int:
    """A signed 64-bit key from a record's own key ('award:<reference>'), as SQLite stores an INTEGER."""
    return int.from_bytes(hashlib.blake2b(text.encode("utf-8"), digest_size=8).digest(), "big", signed=True)


def buyer_number(buyer_id: str) -> int:
    """A buyer's number: 40 bits, so the site reads it back exactly as a JavaScript number."""
    return int.from_bytes(hashlib.blake2b(f"buyer:{buyer_id}".encode("utf-8"), digest_size=5).digest(), "big")


def org_number(org_id: object) -> int | None:
    """An organization id's ten hex digits as a number (org-00000000ff is 255); None for anything else.

    The site turns it back into the id (records_db.ts orgId), so no table maps the two.
    """
    return int(org_id[4:], 16) if isinstance(org_id, str) and ORG_ID_RE.match(org_id) else None


def org_id(number: int) -> str:
    return f"org-{number:010x}"


def row_hash(table: Table, values: Sequence) -> int:
    """A signed 64-bit BLAKE2b over the row's columns (without its key), as the ledger stores it.

    JSON keeps None, "" and 0 apart, so the hash changes exactly when a value does.
    """
    payload = json.dumps([table.name, *values], ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return int.from_bytes(hashlib.blake2b(payload.encode("utf-8"), digest_size=8).digest(), "big", signed=True)


def fiscal(day: object) -> tuple[int | None, int | None]:
    """The federal fiscal year (by the calendar year it starts in) and quarter of an ISO date.

    April 1 2025 to March 31 2026 is 2025 (2025-26); April to June is quarter 1,
    January to March quarter 4. (None, None) without a usable date.
    """
    m = _DAY.match(str(day or ""))
    if not m:
        return None, None
    year, month = int(m.group(1)), int(m.group(2))
    if not 1 <= month <= 12:
        return None, None
    return (year if month >= 4 else year - 1), (month - 4) % 12 // 3 + 1


def cents_of(value: object) -> int | None:
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    v = float(value)
    return round(v * 100) if math.isfinite(v) else None


# The published contracts' solicitation procedure codes (TBS guide), which
# the CanadaBuys procurement methods map onto.
METHOD_CODES = ("OB", "TC", "ST", "TN", "AC")


def method_code(method: object) -> str | None:
    """The TBS two-letter code of a CanadaBuys procurement method or a published contract's procedure.

    "Competitive - Open bidding" is OB, "- Traditional" TC, "- Selective
    tendering" ST, "Non-competitive" TN and "Advance contract award notice"
    AC; a published contract's code is taken as it stands. Anything else
    (another competitive method, a blank) is None; whether the record was
    competitive is records.comp, read by normalize.competitive.
    """
    text = re.sub(r"\s+", " ", str(method or "")).strip()
    if text.upper() in METHOD_CODES:
        return text.upper()
    low = text.casefold()
    if low.startswith(("non-competitive", "non competitive")):
        return "TN"
    if low.startswith("advance contract award"):
        return "AC"
    if low.startswith("competitive"):
        for words, code in (("open bidding", "OB"), ("traditional", "TC"), ("selective tendering", "ST")):
            if words in low:
                return code
    return None


# -- the rows ------------------------------------------------------------------

# One statement per source: one row per counted record with its key, the
# record's organization and buyer as indicators.RECORDS reads them, its date,
# the counted value (NULL when another currency, not published or flagged) and
# the three reasons apart, competitiveness, the method, the newest version's
# UNSPSC codes and whether the party is withheld.
_A = organizations
RECORD_SQL = {
    "awards": (
        f"WITH newest AS ({_A._newest_by_reference('awards', ('reference',))}) "
        f"SELECT 'award:' || reference AS key, org, buyer_id AS buyer, awarded AS day, {_A.award_value('award')} AS v, "
        f"{_A.AWARD_NO_VALUE} AS nv, {_A.award_flagged('award')} AS flagged, UPPER(TRIM(COALESCE(currency, ''))) AS cur, "
        "competitive AS comp, method_en AS method, "
        "(SELECT group_concat(c.unspsc, ' ') FROM award_codes c WHERE c.reference = newest.reference "
        "AND c.amendment = newest.amendment) AS codes, supplier_withheld AS withheld FROM newest"
    ),
    "history": (
        f"WITH newest AS ({_A._newest_by_reference('contract_history', ('reference',))}) "
        f"SELECT 'history:' || reference AS key, org, COALESCE(client_id, buyer_id) AS buyer, awarded AS day, "
        f"{_A.award_value('history')} AS v, {_A.AWARD_NO_VALUE} AS nv, {_A.award_flagged('history')} AS flagged, "
        "UPPER(TRIM(COALESCE(currency, ''))) AS cur, competitive AS comp, method_en AS method, "
        "(SELECT group_concat(c.unspsc, ' ') FROM history_codes c WHERE c.reference = newest.reference "
        "AND c.amendment = newest.amendment) AS codes, supplier_withheld AS withheld FROM newest"
    ),
    "contracts": (
        "SELECT 'contract:' || owner_org || ':' || reference AS key, organization_id AS org, buyer_id AS buyer, "
        f"contract_date AS day, {_A.CONTRACT_CHECKED} AS v, {_A.CONTRACT_NO_VALUE} AS nv, {_A.CONTRACT_FLAGGED} AS flagged, "
        "'' AS cur, competitive AS comp, solicitation_procedure AS method, NULL AS codes, vendor_withheld AS withheld "
        "FROM contracts"
    ),
    "grants": (
        f"WITH newest AS ({_A._newest_by_reference('grants', ('owner_org', 'reference'))}) "
        "SELECT 'grant:' || owner_org || ':' || reference AS key, org, buyer_id AS buyer, start AS day, value AS v, "
        f"{_A.GRANT_NO_VALUE} AS nv, 0 AS flagged, '' AS cur, NULL AS comp, NULL AS method, NULL AS codes, "
        "recipient_withheld AS withheld FROM newest"
    ),
}


def value_note(v: object, nv: object, flagged: object, cur: object) -> int:
    if flagged:
        return FLAGGED
    if cur not in (None, "", "CAD"):
        return OTHER_CURRENCY
    if v is None or nv:
        return NO_VALUE
    return COUNTED


class _Counts:
    def __init__(self) -> None:
        self.grants_withheld = 0
        self.buyers: dict[int, str] = {}
        self.bad_buyers = 0


def record_rows(conn: sqlite3.Connection, counts: _Counts | None = None) -> Iterator[tuple]:
    """Every row of the records table, values in RECORDS.written order (the key first).

    A notice whose codes reach several of the 57 segments gives its row under
    the lowest, then one row with extra = 1 under each other. A grant whose
    recipient is withheld (a person) gives none; counts.grants_withheld says
    how many were left out.
    """
    tally = counts or _Counts()
    segments = set(read_segments())
    for source, sql in RECORD_SQL.items():
        src = SOURCES[source]
        for r in conn.execute(sql):
            if source == "grants" and r["withheld"]:
                tally.grants_withheld += 1
                continue
            fy, fq = fiscal(r["day"])
            buyer = r["buyer"]
            bid = None
            if isinstance(buyer, str) and BUYER_ID_RE.match(buyer) and len(buyer) <= 80:
                bid = buyer_number(buyer)
                seen = tally.buyers.setdefault(bid, buyer)
                if seen != buyer:
                    raise ValueError(f"buyers {seen!r} and {buyer!r} have the same number; change buyer_number")
            elif buyer is not None:
                tally.bad_buyers += 1
            oid = None if r["withheld"] else org_number(r["org"])
            vnote = value_note(r["v"], r["nv"], r["flagged"], r["cur"])
            cents = cents_of(r["v"]) if vnote == COUNTED else None
            comp = r["comp"] if r["comp"] in (0, 1) else None
            meth = method_code(r["method"])
            sids = sorted({int(c[:2]) for c in str(r["codes"] or "").split() if c[:2] in segments})
            for i, sid in enumerate(sids or [None]):
                key = r["key"] if i == 0 else f"{r['key']}#{sid}"
                yield (key_of(key), src, fy, fq, bid, oid, sid, 1 if i else 0, cents, vnote, comp, meth)


# -- tonight's rows, in temporary tables ----------------------------------------


def _now(table: Table) -> str:
    return f"records_now_{table.code}"


def build(conn: sqlite3.Connection) -> dict:
    """Fill a temporary table per D1 table with tonight's rows and their hashes; return what was left out."""
    for t in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS temp.{_now(t)}")
        conn.execute(f"CREATE TEMP TABLE {_now(t)} ({t.key} INTEGER PRIMARY KEY, {', '.join(t.columns)}, h INTEGER NOT NULL)")
    counts = _Counts()
    marks = ", ".join("?" * (len(RECORDS.written) + 1))

    def hashed(rows: Iterator[tuple]) -> Iterator[tuple]:
        for row in rows:
            yield (*row, row_hash(RECORDS, row[1:]))

    try:
        conn.executemany(f"INSERT INTO temp.{_now(RECORDS)} VALUES ({marks})", hashed(record_rows(conn, counts)))
    except sqlite3.IntegrityError:
        raise ValueError("two records have the same key; key_of needs more bits") from None

    def fill(table: Table, rows: Iterator[tuple]) -> None:
        marks = ", ".join("?" * (len(table.written) + 1))
        conn.executemany(f"INSERT INTO temp.{_now(table)} VALUES ({marks})", ((*r, row_hash(table, r[1:])) for r in rows))

    now = _now(RECORDS)
    fill(BUYER_QUARTERS, (
        (key_of(f"bq:{b}:{s}:{y}:{q}"), b, s, y, q, n, c, nv) for b, s, y, q, n, c, nv in conn.execute(
            f"SELECT bid, src, fy, fq, COUNT(*), SUM(cents), SUM(CASE WHEN vnote = {NO_VALUE} THEN 1 ELSE 0 END) "
            f"FROM temp.{now} WHERE extra = 0 AND bid IS NOT NULL AND fy IS NOT NULL GROUP BY bid, src, fy, fq").fetchall()))
    fill(SEGMENT_YEARS, (
        (key_of(f"sy:{g}:{s}:{y}"), g, s, y, n, c, nv, nb, no) for g, s, y, n, c, nv, nb, no in conn.execute(
            f"SELECT sid, src, fy, COUNT(*), SUM(cents), SUM(CASE WHEN vnote = {NO_VALUE} THEN 1 ELSE 0 END), "
            f"COUNT(DISTINCT bid), COUNT(DISTINCT oid) FROM temp.{now} WHERE sid IS NOT NULL AND fy IS NOT NULL "
            "GROUP BY sid, src, fy").fetchall()))
    named = {r[0] for r in conn.execute(f"SELECT DISTINCT oid FROM temp.{now} WHERE oid IS NOT NULL")}
    orgs = []
    for oid_text, name in conn.execute("SELECT id, display_name FROM organizations"):
        number = org_number(oid_text)
        if number in named:
            orgs.append((number, re.sub(r"\s+", " ", name or "").strip() or oid_text))
            named.discard(number)
    # A record naming an organization the table lacks (it cannot, through the
    # foreign key) would still show its id rather than nothing.
    orgs.extend((number, org_id(number)) for number in sorted(named))
    fill(ORGS, iter(orgs))
    names = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT id, name_en, name_fr FROM buyers")}
    buyers = []
    for bid, text in sorted(counts.buyers.items()):
        en, fr = names.get(text, (None, None))
        buyers.append((bid, text, en or text, fr))
    fill(BUYERS, iter(buyers))
    return {"grants_withheld": counts.grants_withheld, "bad_buyers": counts.bad_buyers}


# -- the plan --------------------------------------------------------------------


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


def stage(conn: sqlite3.Connection, reason: str) -> dict[str, dict[str, int]]:
    """records_staged := tonight's differences from the ledger (all of tonight's rows on a full reload).

    A row is staged with its hash when its key is new or its hash changed, and
    with a NULL hash (a delete) when the ledger holds its key and tonight does
    not. Returns the upserts and deletes per table and the rows each table
    holds afterwards.
    """
    conn.execute("DELETE FROM records_staged")
    out = {"upserts": {}, "deletes": {}, "expected": {}}
    for t in TABLES:
        now = f"temp.{_now(t)}"
        if reason:
            conn.execute(f"INSERT INTO records_staged (t, k, h) SELECT ?, {t.key}, h FROM {now}", (t.code,))
        else:
            conn.execute(
                f"INSERT INTO records_staged (t, k, h) SELECT ?, n.{t.key}, n.h FROM {now} n "
                "WHERE NOT EXISTS (SELECT 1 FROM records_ledger l WHERE l.t = ? AND l.k = n." + t.key + " AND l.h = n.h)",
                (t.code, t.code))
            conn.execute(
                f"INSERT INTO records_staged (t, k, h) SELECT l.t, l.k, NULL FROM records_ledger l WHERE l.t = ? "
                f"AND NOT EXISTS (SELECT 1 FROM {now} n WHERE n.{t.key} = l.k)", (t.code,))
        up, down = conn.execute(
            "SELECT COALESCE(SUM(h IS NOT NULL), 0), COALESCE(SUM(h IS NULL), 0) FROM records_staged WHERE t = ?",
            (t.code,)).fetchone()
        out["upserts"][t.name] = up
        out["deletes"][t.name] = down
        out["expected"][t.name] = conn.execute(f"SELECT COUNT(*) FROM {now}").fetchone()[0]
    return out


# -- the batch files ---------------------------------------------------------------


def upsert_statements(table: Table, rows, *, max_rows: int = MAX_ROWS_PER_UPSERT,
                      max_bytes: int = MAX_STATEMENT_BYTES) -> Iterator[str]:
    """The rows (values in table.written order) as multi-row upserts by key, each within max_rows and max_bytes.

    No table here has a trigger, but the upsert keeps the search sync's form:
    a row applied twice reads the same.
    """
    head = f"INSERT INTO {table.name} ({', '.join(table.written)}) VALUES "
    tail = f" ON CONFLICT ({table.key}) DO UPDATE SET {', '.join(f'{c} = excluded.{c}' for c in table.columns)};"

    def render(values: Sequence) -> str:
        if len(values) != len(table.written):
            raise ValueError(f"a {table.name} row has {len(table.written)} values, not {len(values)}")
        parts = []
        for column, value in zip(table.written, values):
            try:
                parts.append(sql_literal(value))
            except (ValueError, TypeError) as exc:
                raise ValueError(f"{table.name} row {values[0]!r}, column {column}: {exc}") from None
        return "(" + ", ".join(parts) + ")"

    return _grouped(rows, render, head, tail, max_rows, max_bytes, lambda v: f"{table.name} row {v[0]!r}")


def delete_statements(table: Table, keys, *, max_keys: int = MAX_KEYS_PER_DELETE,
                      max_bytes: int = MAX_STATEMENT_BYTES) -> Iterator[str]:
    return _grouped(keys, sql_literal, f"DELETE FROM {table.name} WHERE {table.key} IN (", ");", max_keys, max_bytes,
                    lambda k: f"{table.name} delete {k!r}")


def reset_sql(schema_path: Path | None = None) -> str:
    """The first batch of a full reload: drop the tables (their indexes go with them, at no per-row cost),
    create them again from records_schema.sql, and mark the database as loading until finish.sql."""
    drops = "".join(f"DROP TABLE IF EXISTS {t.name};\n" for t in TABLES)
    return ("-- Full reload: drop the records tables and create them again from records_schema.sql.\n" + drops
            + (schema_path or SCHEMA_PATH).read_text(encoding="utf-8")
            + "\nINSERT INTO rec_meta (key, value) VALUES ('state', 'loading') "
              "ON CONFLICT (key) DO UPDATE SET value = excluded.value;\n")


def finish_sql(as_of: str) -> str:
    """What the workflow applies after the count check: the database is ready and describes as_of."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of):
        raise ValueError(f"{as_of!r} is not a date")
    return ("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', " + sql_literal(as_of) + "), "
            "('rules', " + sql_literal(str(RULES_VERSION)) + ") ON CONFLICT (key) DO UPDATE SET value = excluded.value;\n")


def write_batches(conn: sqlite3.Connection, out_dir: Path, *, full: bool, max_bytes: int = MAX_BATCH_BYTES,
                  max_statements: int = MAX_BATCH_STATEMENTS, max_rows_per_upsert: int = MAX_ROWS_PER_UPSERT,
                  max_keys_per_delete: int = MAX_KEYS_PER_DELETE, max_statement_bytes: int = MAX_STATEMENT_BYTES,
                  schema_path: Path | None = None) -> _BatchWriter:
    """The staged rows as batch files: the reset of a full reload alone first, then the deletes, then the upserts."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("batch-*.sql"):
        old.unlink()
    writer = _BatchWriter(out_dir, max_bytes, max_statements)
    if full:
        writer.add(reset_sql(schema_path), "the reset batch")
        writer.flush()
    for t in TABLES:
        keys = (r[0] for r in conn.execute("SELECT k FROM records_staged WHERE t = ? AND h IS NULL ORDER BY k", (t.code,)))
        for statement in delete_statements(t, keys, max_keys=max_keys_per_delete, max_bytes=max_statement_bytes):
            writer.add(statement, f"a {t.name} delete")
    for t in TABLES:
        rows = (tuple(r) for r in conn.execute(
            f"SELECT {', '.join(f'n.{c}' for c in t.written)} FROM records_staged s JOIN temp.{_now(t)} n "
            f"ON n.{t.key} = s.k WHERE s.t = ? AND s.h IS NOT NULL ORDER BY s.k", (t.code,)))
        for statement in upsert_statements(t, rows, max_rows=max_rows_per_upsert, max_bytes=max_statement_bytes):
            writer.add(statement, f"a {t.name} upsert")
    writer.flush()
    return writer


def sync(conn: sqlite3.Connection, out_dir: Path | None = None, *, full: bool = False, today: str | None = None) -> dict:
    """Build, stage and write tonight's sync (the records-sync command); return the manifest.

    The ledger is not touched. The manifest, written last and in one step,
    names a plan number that records-synced holds against the stage.
    """
    out = out_dir or (config.OUT_DIR / "records")
    out.mkdir(parents=True, exist_ok=True)
    # Last night's files must not outlive a plan that fails tonight.
    for name in (MANIFEST, BATCH_LIST, FINISH):
        (out / name).unlink(missing_ok=True)
    left_out = build(conn)
    ledger_empty = conn.execute("SELECT NOT EXISTS (SELECT 1 FROM records_ledger)").fetchone()[0] == 1
    reason = full_reason(conn, requested=full, ledger_empty=ledger_empty, today=today)
    staged = stage(conn, reason)
    plan = secrets.token_hex(8)
    set_meta(conn, META_PLAN, plan)
    if reason:
        set_meta(conn, META_FULL_AT, today or today_iso())
    conn.commit()
    writer = write_batches(conn, out, full=bool(reason))
    as_of = (get_meta(conn, "data_as_of") or today or today_iso())[:10]
    (out / FINISH).write_text(finish_sql(as_of), encoding="utf-8")
    for t in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS temp.{_now(t)}")
    manifest = {
        "generated_at": now_iso(),
        "plan": plan,
        "full": bool(reason),
        "reason": reason,
        "as_of": as_of,
        "batches": writer.files,
        "bytes": writer.bytes,
        "statements": writer.statements,
        **staged,
        "expected_total": sum(staged["expected"].values()),
        "left_out": left_out,
    }
    (out / BATCH_LIST).write_text("".join(f"{name}\n" for name in writer.files), encoding="utf-8")
    partial = out / (MANIFEST + ".partial")
    partial.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    partial.replace(out / MANIFEST)
    return manifest


# -- after the apply -----------------------------------------------------------------

# The statement the workflow runs for the count check: one count per table,
# each named as the table.
COUNT_SQL = "SELECT " + ", ".join(f"(SELECT COUNT(*) FROM {t.name}) AS {t.name}" for t in TABLES)


def read_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("batches"), list) \
            or not isinstance(manifest.get("expected"), dict) or not isinstance(manifest.get("plan"), str):
        raise ValueError(f"{path} is not a records sync manifest")
    return manifest


def expected_counts(manifest: dict) -> dict[str, int]:
    expected = manifest.get("expected")
    if not isinstance(expected, dict) or set(expected) != {t.name for t in TABLES}:
        raise ValueError("the manifest names no row count for each records table")
    return {t.name: int(expected[t.name]) for t in TABLES}


def parse_counts(text: str) -> dict[str, int]:
    """The row counts in Wrangler's JSON answer to COUNT_SQL, by table (anything printed before the list skipped)."""
    start = text.find("[")
    if start < 0:
        raise ValueError("no JSON list in the count answer")
    data, _ = json.JSONDecoder().raw_decode(text, start)
    try:
        row = data[0]["results"][0]
        counts = {t.name: row[t.name] for t in TABLES}
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError(f"the count answer is not the shape COUNT_SQL returns ({type(exc).__name__})") from None
    for name, value in counts.items():
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError(f"the count answer gives {value!r} rows for {name}")
    return counts


def count_check(expected: dict[str, int], actual: dict[str, int]) -> str | None:
    """None when D1 holds the expected number of rows in each table, otherwise what disagrees."""
    wrong = [f"{name} holds {actual.get(name)} rows where the manifest expects {n}"
             for name, n in sorted(expected.items()) if actual.get(name) != n]
    return "; ".join(wrong) or None


def record_sync(conn: sqlite3.Connection, manifest: dict) -> dict[str, int]:
    """Move the staged entries into the ledger, once D1 holds every batch.

    The manifest's plan number must be the stage's (a manifest from another
    night, or planned against another database, records nothing), and the
    ledger must then hold exactly the manifest's expected total. A full
    reload replaces the whole ledger. The stage is emptied, the sync logged
    in records_sync, and a reload asked for earlier is no longer due.
    """
    if manifest.get("plan") != get_meta(conn, META_PLAN):
        raise ValueError("the manifest's plan is not the one staged in this database; nothing recorded")
    expected = int(manifest["expected_total"])
    summary = {k: manifest.get(k) for k in ("generated_at", "full", "reason", "as_of", "bytes", "statements",
                                            "upserts", "deletes", "expected")}
    summary["batches"] = len(manifest.get("batches") or [])
    try:
        if manifest.get("full"):
            conn.execute("DELETE FROM records_ledger")
        upserts = conn.execute(
            "INSERT INTO records_ledger (t, k, h) SELECT t, k, h FROM records_staged WHERE h IS NOT NULL "
            "ON CONFLICT (t, k) DO UPDATE SET h = excluded.h").rowcount
        deletes = conn.execute(
            "DELETE FROM records_ledger WHERE EXISTS (SELECT 1 FROM records_staged s WHERE s.h IS NULL "
            "AND s.t = records_ledger.t AND s.k = records_ledger.k)").rowcount
        held = conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0]
        if held != expected:
            raise ValueError(f"the ledger would hold {held} rows where the manifest expects {expected}")
        conn.execute("DELETE FROM records_staged")
        conn.execute("DELETE FROM meta WHERE key IN (?, ?)", (META_RELOAD, META_PLAN))
        conn.execute("INSERT INTO records_sync (run_at, manifest, rows, full) VALUES (?, ?, ?, ?)",
                     (now_iso(), json.dumps(summary, separators=(",", ":"), sort_keys=True), held,
                      1 if manifest.get("full") else 0))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return {"recorded": upserts, "removed": deletes, "ledger": held}


def request_reload(conn: sqlite3.Connection, when: str | None = None) -> None:
    """Note that a count disagreed, so a coming sync reloads in full (see full_reason)."""
    set_meta(conn, META_RELOAD, when or today_iso())
    conn.commit()


# -- the commands ------------------------------------------------------------------


def add_parsers(sub: argparse._SubParsersAction) -> None:
    """records-sync writes the batches, the workflow applies them with Wrangler and
    reads the row counts back, records-check compares them, the workflow applies
    finish.sql, and only then records-synced records the ledger (docs/analytics.md)."""
    rs = sub.add_parser("records-sync", help="write the records database's changed rows as SQL batches and a manifest")
    rs.add_argument("--db", default=None, help="SQLite path (default data/awardwatch.sqlite)")
    rs.add_argument("--out", default=None, help="folder for the batches and manifest.json (default data/out/records)")
    rs.add_argument("--full", action="store_true", help="a full reload: drop and recreate the tables, then send every row")
    rc = sub.add_parser("records-check", help="compare the row counts read back from D1 with the manifest")
    rc.add_argument("--manifest", required=True)
    rc.add_argument("--counts", required=True, help="Wrangler's --json answer to the count statement (COUNT_SQL)")
    rc.add_argument("--db", default=None,
                    help="SQLite path; when given, a mismatch is noted there so a coming sync reloads in full")
    rd = sub.add_parser("records-synced", help="record the staged ledger entries of a manifest whose batches were applied")
    rd.add_argument("--db", default=None, help="SQLite path (default data/awardwatch.sqlite)")
    rd.add_argument("--manifest", required=True)


def _outcome(outcome: str) -> None:
    out = config.OUT_DIR / "records"
    out.mkdir(parents=True, exist_ok=True)
    (out / OUTCOME).write_text(outcome + "\n", encoding="utf-8")


def command(args: argparse.Namespace) -> int:
    """Run one of COMMANDS. 0 on success; 1 when the counts disagree."""
    if args.command == "records-check":
        return _check(args)
    # "failed" first, replaced only by records-synced, so a night that stops
    # anywhere in between reads as failed in the run status.
    if args.command == "records-sync":
        _outcome("failed")
    conn = connect(args.db)
    try:
        if args.command == "records-sync":
            manifest = sync(conn, Path(args.out) if args.out else None, full=args.full)
            kind = f"full reload ({manifest['reason']})" if manifest["full"] else "changes only"
            summary = (f"records-sync: {kind}: upserts {manifest['upserts']}, deletes {manifest['deletes']}, "
                       f"{len(manifest['batches'])} batches, {manifest['bytes']} bytes, {manifest['statements']} "
                       f"statements, rows expected afterwards {manifest['expected']}, left out {manifest['left_out']}")
            log.info("%s", summary)
            print(summary)
            return 0
        manifest = read_manifest(Path(args.manifest))
        counts = record_sync(conn, manifest)
        outcome = "synced" if manifest["batches"] else "nothing to send"
        log.info("records-synced: %s, ledger %s", outcome, counts)
        _outcome(outcome)
        return 0
    finally:
        conn.close()


def _check(args: argparse.Namespace) -> int:
    manifest = read_manifest(Path(args.manifest))
    actual = parse_counts(Path(args.counts).read_text(encoding="utf-8"))
    problem = count_check(expected_counts(manifest), actual)
    if problem is None:
        print(f"records-check: {actual}, as the manifest expects")
        return 0
    log.error("records-check: %s", problem)
    if args.db:
        conn = connect(args.db)
        try:
            request_reload(conn)
        finally:
            conn.close()
    return 1
