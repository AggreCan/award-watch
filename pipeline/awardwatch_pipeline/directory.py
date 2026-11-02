"""The organization directory: an inbound link to every profile.

Why: a profile's other links come from list pages (awards, rankings, buyer and
category pages) that show the largest and the newest, so most organizations
would be reachable only through the sitemap. The directory lists every one,
A to Z, in one directory per province or territory, PAGE_SIZE to a page, at
/organizations/directory/<code> (page 1) and /organizations/directory/<code>/<n>.
Two more directories hold the rest: "xx" for an organization whose main
address is outside Canada and "un" for one whose records carry no usable
place (no country, or Canada with no province).

The directory an organization files under is its own main place
(organizations.country and province, the ones seen most often on its
records); an organization has one profile wherever it was seen.

Output tree (under data/out/static):
  directory/index.json        every directory: code, organization count, page count
  directory/<code>/index.json one directory: its counts, each page's first and last name, the page
                              on which each initial starts, the date it last changed
  directory/<code>/<n>.json   page n (from 1): rows of id, name, city, record count and last record date

A row's record count is what the profile counts: award notices, contract
history records, published contracts, grants and lobbying communications
(organizations.n_*). Its last record date is organizations.last_seen, left
out (null) on a row that counts no record, since that date then comes from a
record the count does not hold. Rows sort by the normalized name (organizations.norm_name,
from which the id is made, so it does not change night to night), then the id,
so a page's rows move only when an organization arrives or leaves, and a page
file holds only its rows, so a count changing elsewhere does not rewrite every
page.

Lastmod: the table directory_pages keeps each page's hash and the data date on
which it last changed; the sitemap lists every page with that date. A
directory with no organizations gets an index with no pages and no sitemap entry.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path

from .db import today_iso
from .normalize import PROVINCE_CODES

PAGE_SIZE = 200
PROVINCES = sorted(PROVINCE_CODES)
# An address outside Canada, and a record with no usable address; the site's
# constants.ts writes the same codes in upper case (XX, UN).
OUTSIDE = "xx"
UNKNOWN = "un"
CODES = [p.lower() for p in PROVINCES] + [OUTSIDE, UNKNOWN]


def code_for(country: str | None, province: str | None) -> str:
    """The directory an organization's main place puts it in."""
    if province in PROVINCE_CODES and country in (None, "", "CA"):
        return province.lower()
    if country and country != "CA":
        return OUTSIDE
    return UNKNOWN


def page_path(code: str, page: int) -> str:
    return f"/organizations/directory/{code}" if page == 1 else f"/organizations/directory/{code}/{page}"


def initial(norm: str) -> str:
    """The letter a name files under, '#' for a digit or anything else."""
    first = norm[:1]
    return first.upper() if "a" <= first <= "z" else "#"


def pages(conn: sqlite3.Connection) -> tuple[dict[str, list[list[dict]]], dict[str, str]]:
    """Each directory's pages of rows (an empty list where it has no organization), and each id's normalized name."""
    members: dict[str, list[tuple[str, str, dict]]] = {code: [] for code in CODES}
    norms: dict[str, str] = {}
    for r in conn.execute(
        "SELECT id, display_name, norm_name, country, province, city, last_seen, "
        "n_awards + n_history + n_contracts + n_grants + n_lobbying AS n_records FROM organizations"
    ):
        norms[r["id"]] = r["norm_name"] or ""
        n_records = r["n_records"] or 0
        row = {"id": r["id"], "name": r["display_name"], "city": r["city"], "n_records": n_records,
               "last_seen": r["last_seen"] if n_records else None}
        members[code_for(r["country"], r["province"])].append((r["norm_name"] or "", r["id"], row))
    out: dict[str, list[list[dict]]] = {}
    for code, items in members.items():
        rows = [row for _, _, row in sorted(items, key=lambda t: (t[0], t[1]))]
        out[code] = [rows[i:i + PAGE_SIZE] for i in range(0, len(rows), PAGE_SIZE)]
    return out, norms


def page_hash(rows: list[dict]) -> str:
    text = json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _dump(path: Path, obj: object) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode("utf-8")
    path.write_bytes(data)
    return len(data)


def _record(conn: sqlite3.Connection, written: dict[str, tuple[str, int, str]], today: str) -> dict[str, str]:
    """Bring the ledger in line with tonight's pages; returns each path's changed_on."""
    held = {r["path"]: (r["hash"], r["changed_on"]) for r in conn.execute("SELECT path, hash, changed_on FROM directory_pages")}
    dates: dict[str, str] = {}
    for path, (code, page, digest) in written.items():
        old = held.get(path)
        dates[path] = old[1] if old and old[0] == digest else today
        if not old or old[0] != digest:
            conn.execute(
                "INSERT INTO directory_pages (path, code, page, hash, changed_on) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(path) DO UPDATE SET code = excluded.code, page = excluded.page, hash = excluded.hash, "
                "changed_on = excluded.changed_on", (path, code, page, digest, today))
    gone = [(path,) for path in held if path not in written]
    conn.executemany("DELETE FROM directory_pages WHERE path = ?", gone)
    conn.commit()
    return dates


def write_all(conn: sqlite3.Connection, out: Path, data_as_of: str | None) -> dict[str, int]:
    """Write directory/ under out and record each page in the ledger; returns counts for the run log."""
    today = (data_as_of or "")[:10] if re.match(r"\d{4}-\d{2}-\d{2}", data_as_of or "") else today_iso()
    by_code, norms = pages(conn)
    written: dict[str, tuple[str, int, str]] = {}
    for code, chunks in by_code.items():
        for n, rows in enumerate(chunks, start=1):
            _dump(out / "directory" / code / f"{n}.json", {"code": code, "page": n, "rows": rows})
            written[page_path(code, n)] = (code, n, page_hash(rows))
    dates = _record(conn, written, today)
    summary = []
    for code, chunks in by_code.items():
        letters: list[list] = []
        for n, rows in enumerate(chunks, start=1):
            for row in rows:
                letter = initial(norms[row["id"]])
                if all(letter != have for have, _ in letters):
                    letters.append([letter, n])
        changed = max((dates[page_path(code, n)] for n in range(1, len(chunks) + 1)), default=None)
        organizations = sum(len(rows) for rows in chunks)
        _dump(out / "directory" / code / "index.json", {
            "code": code,
            "organizations": organizations,
            "pages": len(chunks),
            "page_size": PAGE_SIZE,
            "ranges": [[rows[0]["name"], rows[-1]["name"]] for rows in chunks],
            "letters": letters,
            "updated": changed,
        })
        summary.append({"code": code, "organizations": organizations, "pages": len(chunks), "updated": changed})
    _dump(out / "directory" / "index.json", {"page_size": PAGE_SIZE, "directories": summary})
    return {"directory_pages": len(written), "directory_organizations": sum(s["organizations"] for s in summary)}


def sitemap_entries(conn: sqlite3.Connection) -> list[tuple[str, str | None]]:
    """(path, lastmod) for every directory page the last export wrote, by directory and page."""
    order = {code: i for i, code in enumerate(CODES)}
    rows = conn.execute("SELECT path, code, page, changed_on FROM directory_pages").fetchall()
    rows = sorted(rows, key=lambda r: (order.get(r["code"], len(order)), r["code"], r["page"]))
    return [(r["path"], r["changed_on"]) for r in rows]
