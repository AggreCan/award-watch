"""Organizations: every supplier, recipient and lobbying client, merged on the normalized legal name.

The identity is normalize.norm_name of the legal part of a name and the id is
normalize.org_id of it, with no province: a federal supplier appears with many
addresses, and one profile is what a reader wants. Private individuals are
never stored (matching.is_person_name); upsert refuses them.

Two kinds of write:

* upsert, at load, once per record version a loader writes: creates the row
  (its name and place are placeholders until recompute), and counts the raw
  spelling, the operating name split off it and the address in
  organization_names and organization_places.
* recompute, once a night after every source: rebuilds those counts from the
  record tables themselves (so a source rewritten whole, or a version whose
  supplier changed, cannot leave a count behind), removes organizations no
  record points to any more, and derives the display name, main place,
  counters, totals, first and last record dates and business number. A row is
  written only when one of its values changed, so updated_at is a high-water
  mark the export and the sitemaps can read.

Each record table keeps the organization's spelling in one column and its
address in a fixed set, normalized at load through place_key so the rebuild
reads them back unchanged: awards and contract_history supplier_raw and
supplier_country/province/city/postal; contracts vendor_raw, vendor_country
and vendor_postal; grants legal_name, country, province, city and postal_code;
lobbying_communications client_raw (no address). Names from the registry
(source 'registry') are left alone by the rebuild.

Totals follow CLAUDE.md "Counting money", CAD only, each source on its own:

* awards and contract history: one contract per reference; its value is the
  newest amendment's total_value when positive, else its amount; a cancelled
  contract counts zero; a currency other than CAD (blank is CAD) is left out;
* published contracts: each row's own value (amendment_value on an
  amendment, else original_value when set, else contract_value);
* grants: one agreement per department and reference, the value on its
  highest amendment.

The counters count what the totals add up (contracts by reference,
agreements, published-contract rows, lobbying communications), including the
ones a total leaves out (another currency, cancelled).
"""

from __future__ import annotations

import logging
import sqlite3
from collections import Counter, defaultdict

from .db import log_run, now_iso
from .normalize import (
    POSTAL_PROVINCE, PROVINCE_CODES, business_number, country_code, norm_name, org_id, province_code,
    split_trade_name, squash,
)
from .sources import matching

log = logging.getLogger(__name__)

# The record sources whose names the nightly rebuild derives: the source label
# in organization_names, then the table and column holding the spelling as
# loaded. A source may have a second column under its own label: a grant's
# operating name is a second spelling of its recipient, not a legal name.
NAME_COLUMNS: dict[str, tuple[str, str]] = {
    "awards": ("awards", "supplier_raw"),
    "history": ("contract_history", "supplier_raw"),
    "contracts": ("contracts", "vendor_raw"),
    "grants": ("grants", "legal_name"),
    "grants:operating": ("grants", "operating_name"),
    "lobbying": ("lobbying_communications", "client_raw"),
}
PLACE_QUERIES = [
    "SELECT organization_id, supplier_country, supplier_province, supplier_city, supplier_postal, COUNT(*) "
    "FROM awards WHERE organization_id IS NOT NULL GROUP BY 1, 2, 3, 4, 5",
    "SELECT organization_id, supplier_country, supplier_province, supplier_city, supplier_postal, COUNT(*) "
    "FROM contract_history WHERE organization_id IS NOT NULL GROUP BY 1, 2, 3, 4, 5",
    "SELECT organization_id, vendor_country, NULL, NULL, vendor_postal, COUNT(*) "
    "FROM contracts WHERE organization_id IS NOT NULL GROUP BY 1, 2, 5",
    "SELECT organization_id, country, province, city, postal_code, COUNT(*) "
    "FROM grants WHERE organization_id IS NOT NULL GROUP BY 1, 2, 3, 4, 5",
]
# Every table whose rows point at an organization; one with none left is removed.
RECORD_TABLES = ("awards", "contract_history", "contracts", "grants", "lobbying_communications")

FIELDS = ("display_name", "country", "province", "city", "postal_code", "business_number", "first_seen",
          "last_seen", "n_awards", "n_history", "n_contracts", "n_grants", "n_lobbying", "total_awards",
          "total_history", "total_contracts", "total_grants")


def tidy_city(raw: object) -> str:
    """'OTTAWA' and 'ottawa' -> 'Ottawa', "ST. JOHN'S" -> "St. John's"; a mixed-case spelling is kept."""
    text = squash(raw)
    if not text or (text != text.upper() and text != text.lower()):
        return text
    out = []
    for word in text.lower().split(" "):
        out.append("-".join(part[:1].upper() + part[1:] for part in word.split("-")))
    return " ".join(out)


def place_key(country: object = None, province: object = None, city: object = None,
              postal: object = None) -> tuple[str, str, str, str]:
    """(country, province, city, postal_code) as organization_places keys them, '' for unknown.

    The country is folded to ISO alpha-2 and is Canada when only a Canadian
    province or postal code is given; the province is a Canadian code or
    blank (a state abroad is not kept), filled from the postal code's first
    letter when missing; a Canadian postal code is written 'A1A 1A1' and any
    other kept as given.
    """
    code = country_code(country) if squash(country) else None
    raw_postal = squash(postal)
    postal_ca = matching.postal_code(raw_postal) if raw_postal else None
    prov = province_code(squash(province)) if squash(province) else None
    prov = prov if prov in PROVINCE_CODES else None
    if code is None and (prov or postal_ca):
        code = "CA"
    if code == "CA":
        prov = prov or (POSTAL_PROVINCE.get(postal_ca[0]) if postal_ca else None)
        postal_out = postal_ca or raw_postal.upper()
    else:
        prov = None
        postal_out = raw_postal.upper()
    return code or "", prov or "", tidy_city(city), postal_out


def _count_name(conn: sqlite3.Connection, oid: str, raw: str, source: str) -> None:
    conn.execute(
        "INSERT INTO organization_names (organization_id, raw_name, source, n) VALUES (?, ?, ?, 1) "
        "ON CONFLICT(organization_id, raw_name, source) DO UPDATE SET n = n + 1",
        (oid, raw, source),
    )


def _operating_name(raw: str) -> str | None:
    """The operating name split off a spelling ('X Ltd. o/a Y' gives 'Y'), unless it reads as a person."""
    operating = split_trade_name(raw)[1]
    if operating and operating != raw and not matching.is_person_name(operating):
        return operating
    return None


def upsert(
    conn: sqlite3.Connection,
    raw_name: str | None,
    *,
    source: str,
    country: str | None = None,
    province: str | None = None,
    city: str | None = None,
    postal_code: str | None = None,
    now: str | None = None,
) -> str | None:
    """Create or count the organization a record names, and return its id.

    None when the name is blank, a placeholder ("N/A"), or its legal part
    reads as a person (the caller then drops the record). Call it once per record version written:
    the spelling, its operating name and the address are counted, and the
    organization's own name and place fields are set only when the row is
    created (recompute owns them after that).
    """
    raw = matching.first_language(raw_name)
    if not raw or matching.is_placeholder(raw) or matching.is_person_name(raw):
        return None
    norm = norm_name(raw)
    if not norm:
        return None
    oid = org_id(norm)
    key = place_key(country, province, city, postal_code)
    conn.execute(
        "INSERT INTO organizations (id, display_name, norm_name, country, province, city, postal_code, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        (oid, raw, norm, key[0] or None, key[1] or None, key[2] or None, key[3] or None, now or now_iso()),
    )
    _count_name(conn, oid, raw, source)
    operating = _operating_name(raw)
    if operating:
        _count_name(conn, oid, operating, source)
    if any(key):
        conn.execute(
            "INSERT INTO organization_places (organization_id, country, province, city, postal_code, n) "
            "VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(organization_id, country, province, city, postal_code) "
            "DO UPDATE SET n = n + 1",
            (oid, *key),
        )
    return oid


# ---------------------------------------------------------------------------
# The nightly recompute
# ---------------------------------------------------------------------------

def _remove_orphans(conn: sqlite3.Connection) -> int:
    clauses = " AND ".join(f"NOT EXISTS (SELECT 1 FROM {t} WHERE organization_id = o.id)" for t in RECORD_TABLES)
    gone = [r[0] for r in conn.execute(f"SELECT id FROM organizations o WHERE {clauses}")]
    for i in range(0, len(gone), 500):
        chunk = gone[i:i + 500]
        marks = ",".join("?" * len(chunk))
        for table in ("organization_names", "organization_places", "registry_matches", "registry_checks",
                      "organization_years"):
            conn.execute(f"DELETE FROM {table} WHERE organization_id IN ({marks})", chunk)
        conn.execute(f"DELETE FROM organizations WHERE id IN ({marks})", chunk)
    return len(gone)


def _rebuild_names(conn: sqlite3.Connection) -> None:
    counts: Counter[tuple[str, str, str]] = Counter()
    for source, (table, column) in NAME_COLUMNS.items():
        for oid, raw, n in conn.execute(
            f"SELECT organization_id, {column}, COUNT(*) FROM {table} "
            f"WHERE organization_id IS NOT NULL AND {column} IS NOT NULL GROUP BY 1, 2"
        ):
            text = matching.first_language(raw)
            if not text:
                continue
            counts[(oid, text, source)] += n
            operating = _operating_name(text)
            if operating:
                counts[(oid, operating, source)] += n
    marks = ",".join("?" * len(NAME_COLUMNS))
    conn.execute(f"DELETE FROM organization_names WHERE source IN ({marks})", list(NAME_COLUMNS))
    conn.executemany(
        "INSERT INTO organization_names (organization_id, raw_name, source, n) VALUES (?, ?, ?, ?)",
        [(oid, raw, source, n) for (oid, raw, source), n in counts.items()],
    )


def _rebuild_places(conn: sqlite3.Connection) -> None:
    counts: Counter[tuple[str, str, str, str, str]] = Counter()
    for sql in PLACE_QUERIES:
        for oid, country, province, city, postal, n in conn.execute(sql):
            key = place_key(country, province, city, postal)
            if any(key):
                counts[(oid, *key)] += n
    conn.execute("DELETE FROM organization_places")
    conn.executemany(
        "INSERT INTO organization_places (organization_id, country, province, city, postal_code, n) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        [(*key, n) for key, n in counts.items()],
    )


def _mixed_case(text: str) -> bool:
    return text != text.upper() and text != text.lower()


def _display_names(conn: sqlite3.Connection) -> dict[str, str]:
    """The spelling seen most often across sources, among those that normalize to the organization's name.

    The operating names split off a spelling are counted in
    organization_names too, and are not the organization's name. A tie goes
    to a spelling in mixed case, then to the first in sort order.
    """
    norms = dict(conn.execute("SELECT id, norm_name FROM organizations"))
    best: dict[str, tuple[tuple, str]] = {}
    for oid, raw, n in conn.execute("SELECT organization_id, raw_name, SUM(n) FROM organization_names GROUP BY 1, 2"):
        rank = (-n, 0 if _mixed_case(raw) else 1, raw)
        current = best.get(oid)
        if current is not None and rank >= current[0]:
            continue
        if norm_name(raw) != norms.get(oid):
            continue
        best[oid] = (rank, raw)
    return {oid: raw for oid, (_, raw) in best.items()}


def _main_places(conn: sqlite3.Connection) -> dict[str, tuple[str | None, str | None, str | None, str | None]]:
    """The country seen most often, the Canadian province seen most often, and the most frequent
    address within them for the city and postal code."""
    rows: dict[str, list[tuple[str, str, str, str, int]]] = defaultdict(list)
    for oid, country, province, city, postal, n in conn.execute(
        "SELECT organization_id, country, province, city, postal_code, n FROM organization_places"
    ):
        rows[oid].append((country, province, city, postal, n))
    out: dict[str, tuple[str | None, str | None, str | None, str | None]] = {}
    for oid, places in rows.items():
        by_country: Counter[str] = Counter()
        by_province: Counter[str] = Counter()
        for country, province, _, _, n in places:
            if country:
                by_country[country] += n
            if province and country == "CA":
                by_province[province] += n
        country = min(by_country, key=lambda c: (-by_country[c], c != "CA", c)) if by_country else ""
        province = min(by_province, key=lambda p: (-by_province[p], p)) if by_province and country == "CA" else ""
        within = [p for p in places if p[0] == country and (not province or p[1] == province)] or places
        city, postal = min(
            ((p[2], p[3], p[4]) for p in within),
            key=lambda c: (-c[2], not c[0], not c[1], c[0], c[1]),
        )[:2]
        out[oid] = (country or None, province or None, city or None, postal or None)
    return out


def _newest_by_reference(table: str, keys: tuple[str, ...]) -> str:
    """The newest version of each contract or agreement, with the organization of its newest version
    that names one (a newest version left without a supplier keeps the contract with its organization)."""
    same = " AND ".join(f"y.{k} = a.{k}" for k in keys)
    same_x = " AND ".join(f"x.{k} = a.{k}" for k in keys)
    return (
        f"SELECT a.*, COALESCE(a.organization_id, (SELECT x.organization_id FROM {table} x WHERE {same_x} "
        f"AND x.organization_id IS NOT NULL ORDER BY x.amendment DESC LIMIT 1)) AS org "
        f"FROM {table} a WHERE a.amendment = (SELECT MAX(y.amendment) FROM {table} y WHERE {same})"
    )


def _figures(conn: sqlite3.Connection) -> dict[str, dict[str, object]]:
    figures: dict[str, dict[str, object]] = defaultdict(dict)

    # Awards and contract history: one contract per reference, valued on its newest amendment.
    for source, table in (("awards", "awards"), ("history", "contract_history")):
        sql = (
            f"WITH newest AS ({_newest_by_reference(table, ('reference',))}) "
            "SELECT org, COUNT(*), SUM(CASE "
            "  WHEN UPPER(TRIM(COALESCE(currency, ''))) NOT IN ('', 'CAD') THEN NULL "
            "  WHEN status = 'cancelled' THEN 0 "
            "  WHEN total_value > 0 THEN total_value "
            "  ELSE COALESCE(amount, 0) END) "
            "FROM newest WHERE org IS NOT NULL GROUP BY org"
        )
        for oid, n, total in conn.execute(sql):
            figures[oid][f"n_{source}"] = n
            figures[oid][f"total_{source}"] = total
        _dates(conn, figures, table, "COALESCE(awarded, published)")

    # Published contracts: each row's own value.
    for oid, n, total in conn.execute(
        "SELECT organization_id, COUNT(*), SUM(CASE "
        "  WHEN instrument_type = 'A' OR (amendment_value IS NOT NULL AND amendment_value != 0) THEN amendment_value "
        "  WHEN original_value IS NOT NULL THEN original_value "
        "  ELSE value END) "
        "FROM contracts WHERE organization_id IS NOT NULL GROUP BY organization_id"
    ):
        figures[oid]["n_contracts"] = n
        figures[oid]["total_contracts"] = total
    _dates(conn, figures, "contracts", "contract_date")

    # Grants: one agreement per department and reference, valued on its highest amendment.
    for oid, n, total in conn.execute(
        f"WITH newest AS ({_newest_by_reference('grants', ('owner_org', 'reference'))}) "
        "SELECT org, COUNT(*), SUM(value) FROM newest WHERE org IS NOT NULL GROUP BY org"
    ):
        figures[oid]["n_grants"] = n
        figures[oid]["total_grants"] = total
    _dates(conn, figures, "grants", "start")

    for oid, n in conn.execute(
        "SELECT organization_id, COUNT(*) FROM lobbying_communications WHERE organization_id IS NOT NULL "
        "GROUP BY organization_id"
    ):
        figures[oid]["n_lobbying"] = n
    _dates(conn, figures, "lobbying_communications", "comm_date")
    return figures


def _dates(conn: sqlite3.Connection, figures: dict[str, dict[str, object]], table: str, column: str) -> None:
    """Widen each organization's first and last record dates with one source's dates."""
    for oid, first, last in conn.execute(
        f"SELECT organization_id, MIN(substr({column}, 1, 10)), MAX(substr({column}, 1, 10)) FROM {table} "
        f"WHERE organization_id IS NOT NULL AND {column} IS NOT NULL AND {column} != '' GROUP BY organization_id"
    ):
        entry = figures[oid]
        if first and (entry.get("first_seen") is None or first < entry["first_seen"]):
            entry["first_seen"] = first
        if last and (entry.get("last_seen") is None or last > entry["last_seen"]):
            entry["last_seen"] = last


def _business_numbers(conn: sqlite3.Connection) -> dict[str, str]:
    """The business number every grant row carrying a valid one agrees on, per organization."""
    seen: dict[str, set[str]] = defaultdict(set)
    for oid, raw in conn.execute(
        "SELECT DISTINCT organization_id, business_number FROM grants "
        "WHERE organization_id IS NOT NULL AND business_number IS NOT NULL AND business_number != ''"
    ):
        bn = business_number(raw)
        if bn:
            seen[oid].add(bn)
    return {oid: next(iter(numbers)) for oid, numbers in seen.items() if len(numbers) == 1}


def _cents(value: object) -> float | None:
    # SUM's order of addition is the query plan's, so the last bits of a total
    # can differ between nights with nothing changed; cents are what is shown.
    return None if value is None else round(float(value), 2)


def recompute(conn: sqlite3.Connection, *, now: str | None = None) -> dict[str, int]:
    """Rebuild the name and place counts, then rewrite every organization whose derived values changed."""
    stamp = now or now_iso()
    removed = _remove_orphans(conn)
    _rebuild_names(conn)
    _rebuild_places(conn)
    names = _display_names(conn)
    places = _main_places(conn)
    figures = _figures(conn)
    numbers = _business_numbers(conn)

    rows = conn.execute(f"SELECT id, {', '.join(FIELDS)} FROM organizations").fetchall()
    changed: list[tuple] = []
    for r in rows:
        oid = r["id"]
        fig = figures.get(oid, {})
        country, province, city, postal = places.get(oid, (None, None, None, None))
        new = {
            "display_name": names.get(oid, r["display_name"]),
            "country": country, "province": province, "city": city, "postal_code": postal,
            "business_number": numbers.get(oid),
            "first_seen": fig.get("first_seen"), "last_seen": fig.get("last_seen"),
            "n_awards": fig.get("n_awards", 0), "n_history": fig.get("n_history", 0),
            "n_contracts": fig.get("n_contracts", 0), "n_grants": fig.get("n_grants", 0),
            "n_lobbying": fig.get("n_lobbying", 0),
            "total_awards": _cents(fig.get("total_awards")), "total_history": _cents(fig.get("total_history")),
            "total_contracts": _cents(fig.get("total_contracts")), "total_grants": _cents(fig.get("total_grants")),
        }
        if any(r[k] != new[k] for k in FIELDS):
            changed.append((*(new[k] for k in FIELDS), stamp, oid))
    conn.executemany(
        f"UPDATE organizations SET {', '.join(f'{k} = ?' for k in FIELDS)}, updated_at = ? WHERE id = ?",
        changed,
    )
    conn.commit()
    return {"organizations": len(rows), "updated": len(changed), "removed": removed}


def run(conn: sqlite3.Connection, *, now: str | None = None) -> dict[str, int]:
    result = recompute(conn, now=now)
    log.info("organizations: %s", result)
    log_run(conn, "organizations",
            detail=f"organizations={result['organizations']} updated={result['updated']} removed={result['removed']}",
            rows_in=result["organizations"], rows_new=result["updated"])
    return result
