"""Buyers: the federal institutions that publish tenders, award contracts and make grants.

One row per institution. The id is the open.canada.ca organization name
(dnd-mdn, pwgsc-tpsgc) when the institution has one; the 353 organizations
come from CKAN's organization_list and one organization_show each, cached and
refreshed when the last load is 30 days old. Each gives the English and
French titles (title_translated), the acronyms (shortform) and the
department number.

CanadaBuys names an institution its own way, with the acronym in trailing
parentheses ("Department of National Defence (DND)"). resolve maps a spelling
to a buyer, in this order:

1. a spelling already in buyer_names (the seed, CKAN's titles, or an earlier
   resolution of the same spelling);
2. the spelling, with or without its acronym, equal to a CKAN or seed title;
3. the acronym matched to one buyer's English acronym (or, failing that, the
   French acronym to one buyer's French acronym);
4. otherwise a new buyer with a slug of the English name and no CKAN
   organization, listed in the stage's notices so the seed can be extended.

Every spelling is recorded in buyer_names with the buyer it resolved to, so
the mapping can be reviewed. The curated seed awardwatch_pipeline/data/buyers.csv
covers the spellings that do not line up (no acronym, or a Crown corporation
that is not a CKAN organization). A spelling resolved by rule 4 before CKAN
was loaded, or before the seed covered it, is resolved again on the next
buyers stage, and its records follow it to the right buyer.
"""

from __future__ import annotations

import csv
import io
import logging
import re
import sqlite3
from pathlib import Path
from urllib.parse import quote

from .. import config
from ..db import get_meta, hours_since, log_run, now_iso, set_meta
from ..http import FetchError, PoliteClient
from ..normalize import slugify, squash
from . import matching

log = logging.getLogger(__name__)

SEED_PATH = config.PACKAGE_DATA / "buyers.csv"
SEED_COLUMNS = ("raw_name", "source", "buyer_id", "name_en", "name_fr", "acronym_en", "acronym_fr")
REFRESH_DAYS = 30
# Shorter than the refresh, so a refresh revalidates every cached answer while
# a run retried the same day reads them from the cache.
CACHE_S = 25 * 86400
META_LOADED = "buyers_loaded_at"
# Spellings matched against titles and acronyms, never resolved by them.
TITLE_SOURCES = ("ckan", "seed")

# Every column that points at a buyer, for moving records when a buyer made
# by rule 4 turns out to be another.
BUYER_COLUMNS = (
    ("tenders", "buyer_id"), ("awards", "buyer_id"), ("contract_history", "buyer_id"),
    ("contract_history", "client_id"), ("contracts", "buyer_id"), ("grants", "buyer_id"),
)

_PAREN_ACRONYM_RE = re.compile(r"\(([^()]{1,30})\)\s*$")
# "Export Development Canada - EDC"
_DASH_ACRONYM_RE = re.compile(r"\s+-\s+([A-Z][A-Za-z0-9&.]{1,11})\s*$")


def split_acronym(raw: object) -> tuple[str, str | None]:
    """'Department of the Environment (ECCC )' -> ('Department of the Environment', 'ECCC')."""
    text = squash(raw)
    m = _PAREN_ACRONYM_RE.search(text) or _DASH_ACRONYM_RE.search(text)
    if not m:
        return text, None
    acronym = re.sub(r"\s+", "", m.group(1))
    name = text[:m.start()].rstrip(" -")
    return (name or text), (acronym or None)


def _acronym_key(text: object) -> str:
    return re.sub(r"[\s.]", "", str(text or "")).casefold()


def _note(conn: sqlite3.Connection, text: str) -> None:
    # A temporary table: per connection, gone when it closes, and rolled back
    # with the stage that created the buyer.
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_notices (text TEXT NOT NULL)")
    conn.execute("INSERT INTO buyer_notices (text) VALUES (?)", (text,))


def take_notices(conn: sqlite3.Connection) -> list[str]:
    """The buyers resolve created since the last call, as notice lines; the list is then emptied."""
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_notices (text TEXT NOT NULL)")
    lines = [r[0] for r in conn.execute("SELECT text FROM buyer_notices ORDER BY rowid")]
    conn.execute("DELETE FROM buyer_notices")
    return lines


def _record(conn: sqlite3.Connection, buyer_id: str, source: str, *names: str) -> None:
    conn.executemany(
        "INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, ?, ?) ON CONFLICT(raw_name, source) DO NOTHING",
        [(name, source, buyer_id) for name in names if name],
    )


def _lookup(conn: sqlite3.Connection, names: list[str], source: str) -> str | None:
    for name in names:
        row = conn.execute("SELECT buyer_id FROM buyer_names WHERE raw_name = ? AND source = ?",
                           (name, source)).fetchone()
        if row:
            return row[0]
    return None


def _by_title(conn: sqlite3.Connection, names: list[str], exclude: set[str]) -> str | None:
    marks = ",".join("?" * len(TITLE_SOURCES))
    for name in names:
        for candidate in dict.fromkeys((name, split_acronym(name)[0])):
            hits = {r[0] for r in conn.execute(
                f"SELECT buyer_id FROM buyer_names WHERE raw_name = ? COLLATE NOCASE AND source IN ({marks})",
                (candidate, *TITLE_SOURCES),
            )} - exclude
            if len(hits) == 1:
                return hits.pop()
    return None


def _by_acronym(conn: sqlite3.Connection, acronym_en: str | None, acronym_fr: str | None,
                exclude: set[str]) -> str | None:
    en, fr = _acronym_key(acronym_en), _acronym_key(acronym_fr)
    if not en and not fr:
        return None
    en_hits: set[str] = set()
    fr_hits: set[str] = set()
    for bid, a_en, a_fr in conn.execute(
        "SELECT id, acronym_en, acronym_fr FROM buyers WHERE acronym_en IS NOT NULL OR acronym_fr IS NOT NULL"
    ):
        if bid in exclude:
            continue
        if en and _acronym_key(a_en) == en:
            en_hits.add(bid)
        if fr and _acronym_key(a_fr) == fr:
            fr_hits.add(bid)
    if len(en_hits) == 1:
        return en_hits.pop()
    if en_hits and fr_hits and len(en_hits & fr_hits) == 1:
        return (en_hits & fr_hits).pop()
    if not en_hits and len(fr_hits) == 1:
        return fr_hits.pop()
    return None


def _match(conn: sqlite3.Connection, en: str, fr: str, exclude: set[str] | None = None) -> str | None:
    """Rules 2 and 3 of the module docstring."""
    skip = exclude or set()
    names = [n for n in (en, fr) if n]
    hit = _by_title(conn, names, skip)
    if hit:
        return hit
    return _by_acronym(conn, split_acronym(en)[1] if en else None, split_acronym(fr)[1] if fr else None, skip)


def resolve(
    conn: sqlite3.Connection,
    raw_en: str | None,
    raw_fr: str | None = None,
    *,
    source: str = "canadabuys",
    now: str | None = None,
) -> str | None:
    """The buyer a source's spelling of an institution names; None when both spellings are blank."""
    en, fr = (squash(raw) for raw in (raw_en, raw_fr))
    en, fr = ("" if matching.is_placeholder(en) else en), ("" if matching.is_placeholder(fr) else fr)
    if not en and not fr:
        return None
    hit = _lookup(conn, [n for n in (en, fr) if n], source) or _match(conn, en, fr)
    if hit:
        _record(conn, hit, source, en, fr)
        return hit
    name_en, acronym_en = split_acronym(en or fr)
    name_fr, acronym_fr = split_acronym(fr) if fr else (None, None)
    bid = slugify(name_en) or slugify(name_fr) or "buyer"
    conn.execute(
        "INSERT INTO buyers (id, name_en, name_fr, acronym_en, acronym_fr, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO NOTHING",
        (bid, name_en, name_fr, acronym_en, acronym_fr, now or now_iso()),
    )
    _record(conn, bid, source, en, fr)
    _note(conn, f"buyer {bid} made for '{en or fr}'")
    return bid


def for_owner_org(conn: sqlite3.Connection, owner_org: str, title: str | None, *, now: str | None = None) -> str:
    """The buyer of a proactive-publication row: its owner_org is the open.canada.ca organization name.

    Created from the "English | French" title when CKAN did not list it (a
    run without CKAN, or an organization created since the last load).
    """
    bid = squash(owner_org)
    if conn.execute("SELECT 1 FROM buyers WHERE id = ?", (bid,)).fetchone():
        return bid
    parts = [squash(p) for p in str(title or "").split("|")]
    name_en = parts[0] if parts and parts[0] else bid
    name_fr = parts[1] if len(parts) > 1 and parts[1] else None
    conn.execute(
        "INSERT INTO buyers (id, name_en, name_fr, ckan_org, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        (bid, name_en, name_fr, bid, now or now_iso()),
    )
    _record(conn, bid, "ckan", name_en, name_fr or "")
    return bid


# ---------------------------------------------------------------------------
# Loading: CKAN organizations and the seed
# ---------------------------------------------------------------------------

def _pair(value: object) -> tuple[str | None, str | None]:
    """CKAN's bilingual fields arrive as {"en": .., "fr": ..} or as "English | French"."""
    if isinstance(value, dict):
        return squash(value.get("en")) or None, squash(value.get("fr")) or None
    parts = [squash(p) for p in str(value or "").split("|")]
    return (parts[0] or None) if parts else None, (parts[1] or None) if len(parts) > 1 else None


def upsert_ckan(conn: sqlite3.Connection, org: dict, *, now: str) -> str | None:
    """Write one organization_show result as a buyer; returns the id, None when it has no name."""
    bid = squash(org.get("name"))
    if not bid:
        return None
    title_en, title_fr = _pair(org.get("title_translated"))
    plain_en, plain_fr = _pair(org.get("title"))
    name_en = title_en or plain_en or bid
    name_fr = title_fr or plain_fr
    acronym_en, acronym_fr = _pair(org.get("shortform"))
    number = squash(org.get("department_number")) or None
    values = (name_en, name_fr, acronym_en, acronym_fr, bid, number)
    row = conn.execute("SELECT name_en, name_fr, acronym_en, acronym_fr, ckan_org, department_number FROM buyers "
                       "WHERE id = ?", (bid,)).fetchone()
    if row is None:
        conn.execute("INSERT INTO buyers (id, name_en, name_fr, acronym_en, acronym_fr, ckan_org, department_number, "
                     "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (bid, *values, now))
    elif tuple(row) != values:
        conn.execute("UPDATE buyers SET name_en = ?, name_fr = ?, acronym_en = ?, acronym_fr = ?, ckan_org = ?, "
                     "department_number = ?, updated_at = ? WHERE id = ?", (*values, now, bid))
    conn.executemany(
        "INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, 'ckan', ?) "
        "ON CONFLICT(raw_name, source) DO UPDATE SET buyer_id = excluded.buyer_id",
        [(name, bid) for name in (name_en, name_fr) if name],
    )
    return bid


def load_ckan(conn: sqlite3.Connection, client: PoliteClient, *, now: str) -> tuple[list[str], list[str]]:
    """organization_list, then organization_show per name; returns (ids loaded, names that failed)."""
    listing = client.get_json(config.CKAN_ORGANIZATION_LIST, cache=True, max_age_s=CACHE_S)
    if not listing.get("success") or not isinstance(listing.get("result"), list):
        raise ValueError("organization_list did not answer with a list of names")
    loaded: list[str] = []
    failed: list[str] = []
    for name in listing["result"]:
        url = config.CKAN_ORGANIZATION_SHOW.format(name=quote(str(name), safe=""))
        try:
            answer = client.get_json(url, cache=True, max_age_s=CACHE_S)
        except (FetchError, ValueError) as exc:
            log.warning("organization_show %s: %s", name, exc)
            failed.append(str(name))
            continue
        bid = upsert_ckan(conn, answer.get("result") or {}, now=now) if answer.get("success") else None
        if bid:
            loaded.append(bid)
        else:
            failed.append(str(name))
    conn.commit()
    return loaded, failed


def read_seed(path: Path | None = None) -> list[dict[str, str]]:
    """The seed's rows; lines starting with '#' are comments."""
    src = path or SEED_PATH
    if not src.exists():
        return []
    lines = [line for line in src.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")]
    rows = []
    for rec in csv.DictReader(io.StringIO("\n".join(lines))):
        row = {k: squash(rec.get(k)) for k in SEED_COLUMNS}
        if row["buyer_id"]:
            rows.append(row)
    return rows


def load_seed(conn: sqlite3.Connection, rows: list[dict[str, str]], *, now: str) -> int:
    """Create the seed's buyers where missing (filling blanks, never overwriting CKAN's values) and map its spellings.

    A seed mapping wins over any earlier resolution of the same spelling.
    """
    for row in rows:
        conn.execute(
            "INSERT INTO buyers (id, name_en, name_fr, acronym_en, acronym_fr, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET name_fr = COALESCE(buyers.name_fr, excluded.name_fr), "
            "acronym_en = COALESCE(buyers.acronym_en, excluded.acronym_en), "
            "acronym_fr = COALESCE(buyers.acronym_fr, excluded.acronym_fr)",
            (row["buyer_id"], row["name_en"] or row["buyer_id"], row["name_fr"] or None, row["acronym_en"] or None,
             row["acronym_fr"] or None, now),
        )
        names = [n for n in (row["name_en"], row["name_fr"]) if n]
        conn.executemany(
            "INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, 'seed', ?) ON CONFLICT DO NOTHING",
            [(n, row["buyer_id"]) for n in names],
        )
        if row["raw_name"]:
            conn.execute(
                "INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, ?, ?) "
                "ON CONFLICT(raw_name, source) DO UPDATE SET buyer_id = excluded.buyer_id",
                (row["raw_name"], row["source"] or "canadabuys", row["buyer_id"]),
            )
    conn.commit()
    return len(rows)


def reresolve(conn: sqlite3.Connection, seed_ids: set[str]) -> list[str]:
    """Resolve again the spellings that went to a buyer made by rule 4, and move its records when it is now another.

    A made buyer is one with no CKAN organization that the seed does not
    name. When every spelling of it now resolves to one other buyer, its
    records move there and it is deleted; when they split, the records stay
    and are resolved again as their files are read again.
    """
    made = {r[0] for r in conn.execute("SELECT id FROM buyers WHERE ckan_org IS NULL")} - seed_ids
    if not made:
        return []
    targets: dict[str, set[str]] = {}
    for raw, source, old in conn.execute(
        "SELECT raw_name, source, buyer_id FROM buyer_names WHERE source NOT IN ('ckan', 'seed')"
    ).fetchall():
        if old not in made:
            continue
        name, acronym = split_acronym(raw)
        new = _by_title(conn, [raw], made) or _by_acronym(conn, acronym, None, made) \
            or _by_acronym(conn, None, acronym, made)
        if new and new != old:
            conn.execute("UPDATE buyer_names SET buyer_id = ? WHERE raw_name = ? AND source = ?", (new, raw, source))
            targets.setdefault(old, set()).add(new)
    merged = []
    for old, news in sorted(targets.items()):
        left = conn.execute("SELECT COUNT(*) FROM buyer_names WHERE buyer_id = ?", (old,)).fetchone()[0]
        if left or len(news) != 1:
            continue
        new = next(iter(news))
        for table, column in BUYER_COLUMNS:
            conn.execute(f"UPDATE {table} SET {column} = ? WHERE {column} = ?", (new, old))
        conn.execute("UPDATE lobbying_communications SET buyer_ids = replace(buyer_ids, ?, ?) WHERE buyer_ids LIKE ?",
                     (f'"{old}"', f'"{new}"', f'%"{old}"%'))
        conn.execute("DELETE FROM buyers WHERE id = ?", (old,))
        merged.append(f"{old} -> {new}")
    conn.commit()
    return merged


def _seed_review(conn: sqlite3.Connection, seed_ids: set[str], ckan_ids: set[str]) -> list[str]:
    """Seed buyers outside CKAN whose acronym or name a CKAN organization also has: worth a look."""
    lines = []
    for bid in sorted(seed_ids - ckan_ids):
        row = conn.execute("SELECT name_en, acronym_en FROM buyers WHERE id = ?", (bid,)).fetchone()
        if row is None:
            continue
        twin = _by_acronym(conn, row["acronym_en"], None, {bid} | (seed_ids - ckan_ids)) \
            or _by_title(conn, [row["name_en"]], {bid} | (seed_ids - ckan_ids))
        if twin:
            lines.append(f"seed buyer {bid} may be the CKAN organization {twin}")
    return lines


def run(conn: sqlite3.Connection, client: PoliteClient | None, *, now: str | None = None,
        offline: bool = False) -> dict[str, int]:
    """The buyers stage: CKAN organizations when due, then the seed, then the spellings made before either."""
    stamp = now or now_iso()
    before = conn.execute("SELECT COUNT(*) FROM buyers").fetchone()[0]
    notices: list[str] = []
    loaded: list[str] = []
    if offline or client is None:
        notices.append("open.canada.ca organizations not loaded (samples run)")
    else:
        age = hours_since(conn, META_LOADED, now=stamp)
        if age is None or age >= REFRESH_DAYS * 24:
            loaded, failed = load_ckan(conn, client, now=stamp)
            if failed:
                notices.append(f"organization_show failed for {len(failed)}: {', '.join(failed[:10])}")
            else:
                set_meta(conn, META_LOADED, stamp)
                conn.commit()
    seed = read_seed()
    seed_ids = {row["buyer_id"] for row in seed}
    load_seed(conn, seed, now=stamp)
    merged = reresolve(conn, seed_ids)
    if merged:
        notices.append("buyers merged: " + ", ".join(merged))
    if loaded:
        notices += _seed_review(conn, seed_ids, set(loaded))
    total = conn.execute("SELECT COUNT(*) FROM buyers").fetchone()[0]
    last = get_meta(conn, META_LOADED) or "never"
    log_run(conn, "buyers",
            detail=f"buyers={total} ckan_loaded={len(loaded)} seed_rows={len(seed)} merged={len(merged)} "
                   f"ckan_last_loaded={last}",
            rows_in=total, rows_new=max(total - before, 0), notice=" | ".join(notices) or None)
    return {"buyers": total, "ckan": len(loaded), "seed": len(seed), "merged": len(merged)}
