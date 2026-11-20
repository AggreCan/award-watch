"""Search Console's figures by page and by query, beside the daily totals.

Why: search_console.py keeps each day's totals and its top 50 queries, so
when clicks fell on 2026-11-14 (6 to 12 a day before, 0 or 1 after) nothing
kept could say which pages lost them. Once a night, beside that import, this
asks the Search Analytics API for each final day after the newest one these
files hold and appends, per day, its top TOP_ROWS pages to `search_pages.csv`
and its top TOP_ROWS queries to `search_queries.csv` (clicks, impressions,
average position). The workflow keeps both under `views/` in R2, private.

What "top" means: Search Console answers rows sorted by clicks, and on a day
with a handful of clicks most rows have none, so the order among them would
be Google's. Each day is asked for at most ROWS_ASKED rows and ranked here by
clicks, then impressions, then the text, and the first TOP_ROWS are kept.

The first night: neither file exists, and the import starts at BACKFILL_FROM
(2026-11-01), so the fall of 2026-11-14 is in them with the days before it;
Search Console keeps 16 months, so those days are still there. At most
MAX_DAYS days a night (two requests each); the next night goes on.

Only final data (dataState "final"), as the totals: a stored day never
changes, and the newest two or three days arrive on later nights. A day with
no impressions has no row in the date answer and none here.

A query that reads as a private individual's name (the pipeline's person
test, sources/matching.is_person_name) is stored as WITHHELD, its figures
added to that row's, so no person's name reaches the file or the report.
Google itself leaves out queries made by very few people.

Signing in, the property and the secret are search_console.py's: the same
service account, the same read-only scope. Nothing here prints or logs a
figure; the log says which days were imported.
"""

from __future__ import annotations

import csv
import io
import logging
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit

from . import config
from .search_console import (CONTROL_RE, DATE_RE, FAILED, HISTORY_DAYS, NO_CREDENTIALS, QUERY_MAX_CHARS, SECRET_ENV,
                             UP_TO_DATE, FileError, SearchConsoleError, _figure, _key, access_token, day_rows,
                             parse_account, search, site_property)

log = logging.getLogger(__name__)

PAGES_FILE = "search_pages.csv"
QUERIES_FILE = "search_queries.csv"
PAGES_HEADER = ["date", "page", "clicks", "impressions", "position"]
QUERIES_HEADER = ["date", "query", "clicks", "impressions", "position"]
OUTCOME = "detail_outcome.txt"

# The first day kept when neither file exists: two weeks before the fall of 2026-11-14.
BACKFILL_FROM = date(2026, 11, 1)
TOP_ROWS = 250
# Rows asked for a day, ranked here (the API's own limit is 25,000).
ROWS_ASKED = 25_000
MAX_DAYS = 60
PAGE_MAX_CHARS = 400
WITHHELD = "(withheld: reads as a person's name)"


def _is_person(text: str) -> bool:
    try:
        from .sources.matching import is_person_name
    except Exception:  # the person test's data missing: withhold nothing rather than fail the import
        return False
    try:
        return bool(is_person_name(text))
    except Exception:
        return False


def own_page(url: str, site_url: str) -> bool:
    """Whether a page Search Console names is one of the site's: http or https on the site's host or its www."""
    host = (urlsplit(site_url).hostname or "").lower()
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    name = (parts.hostname or "").lower()
    return bool(host) and parts.scheme in ("http", "https") and name in (host, f"www.{host}")


def ranked(rows: list[dict[str, Any]], kind: str, site_url: str) -> list[list[Any]]:
    """[text, clicks, impressions, position] for one day, at most TOP_ROWS, most clicks then most impressions
    first. kind "page" keeps the site's own pages only; kind "query" withholds a query that reads as a person's
    name, adding its figures to one WITHHELD row (position weighted by impressions)."""
    merged: dict[str, list[float]] = {}
    for row in rows:
        raw = _key(row)
        text = CONTROL_RE.sub(" ", raw).strip()
        if not text:
            continue
        if kind == "page":
            # An address never holds a space or a control byte: such a key is not a page, and is not kept.
            if raw != text or " " in raw or len(raw) > PAGE_MAX_CHARS or not own_page(raw, site_url):
                continue
        else:
            text = text[:QUERY_MAX_CHARS]
            if _is_person(text):
                text = WITHHELD
        clicks, impressions, position = _figure(row.get("clicks")), _figure(row.get("impressions")), _figure(row.get("position"))
        held = merged.setdefault(text, [0.0, 0.0, 0.0])
        held[0] += clicks
        held[1] += impressions
        held[2] += position * impressions
    out = [[text, int(round(c)), int(round(i)), round(w / i, 1) if i else 0.0] for text, (c, i, w) in merged.items()]
    out.sort(key=lambda r: (-r[1], -r[2], r[0]))
    return out[:TOP_ROWS]


# -- the files ------------------------------------------------------------------


def read_rows(path: Path, header: list[str]) -> list[dict[str, str]]:
    """The stored rows; none when the file does not exist. Raises FileError when it exists but is empty,
    unreadable, has another header, or a row without a date: it is then never replaced."""
    if not path.exists():
        return []
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise FileError(f"{path.name} cannot be read: {exc}") from None
    if not text.strip():
        raise FileError(f"{path.name} is empty")
    reader = csv.DictReader(io.StringIO(text))
    if (reader.fieldnames or []) != header:
        raise FileError(f"{path.name} has an unexpected header: {','.join(reader.fieldnames or [])[:200]}")
    rows = []
    for row in reader:
        stamp = row.get("date") or ""
        try:
            ok = None not in row and bool(DATE_RE.match(stamp)) and date.fromisoformat(stamp) is not None
        except ValueError:
            ok = False
        if not ok:
            raise FileError(f"{path.name} has a malformed row near {stamp[:20]!r}")
        rows.append({k: (row.get(k) or "") for k in header})
    return rows


def write_rows(path: Path, header: list[str], rows: list[dict[str, Any]]) -> None:
    """Through a temporary file, LF line ends, rows in date order (a day's own order kept)."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=header, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    writer.writerows(sorted(rows, key=lambda r: r["date"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_bytes(buf.getvalue().encode("utf-8"))
    partial.replace(path)


def newest(rows: list[dict[str, str]]) -> date | None:
    return max((date.fromisoformat(r["date"]) for r in rows), default=None)


def start_day(pages: list[dict[str, str]], queries: list[dict[str, str]], today: date) -> date:
    """The first day due: after the newest day both files hold (the earlier of the two, so a night that wrote one
    file and not the other is made up), BACKFILL_FROM when either is empty, never older than Search Console keeps."""
    held = [newest(pages), newest(queries)]
    oldest = today - timedelta(days=HISTORY_DAYS)
    first = BACKFILL_FROM if None in held else min(d for d in held if d is not None) + timedelta(days=1)
    return max(first, oldest)


# -- the run --------------------------------------------------------------------


def run(out_dir: Path | None = None, *, env: Mapping[str, str] | None = None, session: Any | None = None,
        now: datetime | None = None) -> str:
    """Import the days due. Returns "imported <n> days", "up to date", "no credentials" or "failed"; never
    raises, and never logs a figure."""
    try:
        return _run(out_dir, env=env, session=session, now=now)
    except Exception as exc:
        log.error("search console by page and query: failed (%s): %s", type(exc).__name__, str(exc)[:200])
        return FAILED


def _run(out_dir: Path | None, *, env: Mapping[str, str] | None, session: Any | None, now: datetime | None) -> str:
    source = os.environ if env is None else env
    folder = out_dir or (config.OUT_DIR / "search_console")
    folder.mkdir(parents=True, exist_ok=True)
    secret = (source.get(SECRET_ENV) or "").strip()
    if not secret:
        return NO_CREDENTIALS
    try:
        account = parse_account(secret)
    except ValueError as exc:
        log.error("search console by page and query: %s; nothing imported", exc)
        return FAILED
    site = site_property(source)
    if not site:
        log.error("search console by page and query: no property to read; nothing imported")
        return FAILED
    try:
        pages = read_rows(folder / PAGES_FILE, PAGES_HEADER)
        queries = read_rows(folder / QUERIES_FILE, QUERIES_HEADER)
    except FileError as exc:
        log.error("search console by page and query: %s; nothing imported, and the files are left as they are", exc)
        return FAILED

    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    start, end = start_day(pages, queries, current.date()), current.date() - timedelta(days=1)
    if start > end:
        return UP_TO_DATE
    held_pages = {r["date"] for r in pages}
    held_queries = {r["date"] for r in queries}

    if session is None:
        import requests
        http: Any = requests.Session()
    else:
        http = session
    new_pages: list[dict[str, Any]] = []
    new_queries: list[dict[str, Any]] = []
    try:
        token = access_token(http, account, int(current.timestamp()))
        base = {"type": "web", "dataState": "final"}
        final = day_rows(search(http, token, site, {**base, "startDate": start.isoformat(), "endDate": end.isoformat(),
                                                    "dimensions": ["date"], "rowLimit": 25000}), start, end)
        days = [d for d in sorted(final) if d not in held_pages or d not in held_queries][:MAX_DAYS]
        for stamp in days:
            ask = {**base, "startDate": stamp, "endDate": stamp, "rowLimit": ROWS_ASKED}
            if stamp not in held_pages:
                for text, clicks, impressions, position in ranked(
                        search(http, token, site, {**ask, "dimensions": ["page"]}), "page", config.SITE_URL):
                    new_pages.append({"date": stamp, "page": text, "clicks": clicks, "impressions": impressions,
                                      "position": position})
            if stamp not in held_queries:
                for text, clicks, impressions, position in ranked(
                        search(http, token, site, {**ask, "dimensions": ["query"]}), "query", config.SITE_URL):
                    new_queries.append({"date": stamp, "query": text, "clicks": clicks, "impressions": impressions,
                                        "position": position})
    except SearchConsoleError as exc:
        log.error("search console by page and query: %s; nothing imported", exc)
        return FAILED
    finally:
        if session is None:
            http.close()

    if not days:
        log.info("search console by page and query: no final data between %s and %s yet", start, end)
        return UP_TO_DATE
    # Both written only now, so a failure part way leaves both files as they were.
    write_rows(folder / PAGES_FILE, PAGES_HEADER, pages + new_pages)
    write_rows(folder / QUERIES_FILE, QUERIES_HEADER, queries + new_queries)
    log.info("search console by page and query: %d days imported, %s to %s", len(days), days[0], days[-1])
    return f"imported {len(days)} day{'s' if len(days) != 1 else ''}"
