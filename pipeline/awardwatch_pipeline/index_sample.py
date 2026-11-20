"""A nightly sample of the site's own pages, asked of Search Console's URL Inspection API.

Why: Google's clicks fell on 2026-11-14 and its impressions two days later,
and the search figures alone cannot say whether pages fell out of the index.
Once a night this inspects a small, fixed-size sample of the site's pages
and appends what Google says of each to `index_sample.csv`: whether it is
indexed (the verdict), the coverage state Google gives (its reason when a
page is not indexed), and the robots, indexing and fetch states, the last
crawl's date and Google's canonical. The workflow keeps the file under
`views/` in R2, private; the monthly report shows each kind's share indexed.

The sample (SAMPLE, SAMPLE_SIZE in all): open tender notices published in the
TENDER_DAYS days to the data date (tenders/open.json), organizations with an
award notice in the ORGANIZATION_DAYS days to it (awards/recent.json), and
published contracts dated in the CONTRACT_DAYS days to it (the pipeline's
contracts table). Each kind's candidates are ranked by SHA-256 of SEED, the
kind and the page's path, and the lowest are taken: the same candidates give
the same sample every night, and the sample rolls slowly as pages enter and
leave the windows. The addresses are the canonical ones the sitemaps list.

The requests: one POST per page to INSPECT_URL, with the page's address and
the property, one at a time, PAUSE_S apart, none after BUDGET_S. Google's
limits are 2,000 inspections a day and 600 a minute for a property
(developers.google.com/webmaster-tools/limits), so 40 a night is 2% of the
day's allowance. A night already inspected (the file holds today's date) asks
nothing. The token is search_console.py's: the same service account and the
read-only scope (webmasters.readonly), which the method accepts.

Failing soft: an answer of 403 stops the sample at once and the outcome is
"not permitted" (the service account cannot inspect the property: see
docs/search-engines.md); 429 stops it as "rate limited"; any other failure
skips that page. Nothing here raises; the outcome is one word or two in the
run status, and the night goes on. The log names the outcome and never a
token; Google's answers hold no figure about the audience.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import os
import re
import sqlite3
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import quote, urlsplit

from . import config
from .search_console import (DATE_RE, FAILED, NO_CREDENTIALS, SECRET_ENV, UP_TO_DATE, FileError, SearchConsoleError,
                             _body, _status, access_token, parse_account, site_property)
from .search_detail import own_page, read_rows, write_rows

log = logging.getLogger(__name__)

INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
FILE = "index_sample.csv"
HEADER = ["date", "kind", "path", "verdict", "coverage", "robots", "indexing", "fetch", "last_crawl", "google_canonical"]
OUTCOME = "index_outcome.txt"

# The kinds of page and how many of each a night: 40 in all.
SAMPLE: tuple[tuple[str, int], ...] = (("tender", 15), ("organization", 15), ("contract", 10))
SAMPLE_SIZE = sum(n for _, n in SAMPLE)
SEED = "award-watch index sample 1"
TENDER_DAYS = 7
ORGANIZATION_DAYS = 30
CONTRACT_DAYS = 90
# Candidates read from the contracts table at most (by date, newest first).
CONTRACT_CANDIDATES = 50_000
PAUSE_S = 1.0
BUDGET_S = 300.0
LANGUAGE = "en-US"

NOT_PERMITTED = "not permitted"
RATE_LIMITED = "rate limited"
NO_SAMPLE = "no sample"

ORG_ID_RE = re.compile(r"^org-[0-9a-f]{10}$")
BUYER_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REF_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
VERDICT_RE = re.compile(r"^[A-Z_]{1,40}$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
# The longest contract reference the site addresses (records_db.REF_MAX, pages/published.tsx REF_MAX).
REF_MAX = 200
TEXT_MAX = 120


def component(text: str) -> str:
    """One path segment as JavaScript's encodeURIComponent writes it (site/src/pages/shared.tsx contractPath)."""
    return quote(text, safe="!~*'()")


# -- the sample -----------------------------------------------------------------


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _within(value: Any, first: date, last: date) -> bool:
    text = value[:10] if isinstance(value, str) else ""
    if not DATE_RE.match(text):
        return False
    try:
        return first <= date.fromisoformat(text) <= last
    except ValueError:
        return False


def data_date(static: Path) -> date | None:
    stats = _load(static / "stats.json")
    text = stats.get("data_as_of") if isinstance(stats, dict) else None
    try:
        return date.fromisoformat(text) if isinstance(text, str) and DATE_RE.match(text) else None
    except ValueError:
        return None


def tender_paths(static: Path, as_of: date) -> list[str]:
    rows = _load(static / "tenders" / "open.json")
    first = as_of - timedelta(days=TENDER_DAYS - 1)
    out = set()
    for row in rows if isinstance(rows, list) else []:
        ref = row.get("reference") if isinstance(row, dict) else None
        if isinstance(ref, str) and REF_RE.match(ref) and _within(row.get("published"), first, as_of):
            out.add(f"/tenders/{ref.lower()}")
    return sorted(out)


def organization_paths(static: Path, as_of: date) -> list[str]:
    rows = _load(static / "awards" / "recent.json")
    first = as_of - timedelta(days=ORGANIZATION_DAYS - 1)
    out = set()
    for row in rows if isinstance(rows, list) else []:
        oid = row.get("organization_id") if isinstance(row, dict) else None
        if isinstance(oid, str) and ORG_ID_RE.match(oid) and _within(row.get("awarded"), first, as_of):
            out.add(f"/organizations/{oid}")
    return sorted(out)


def contract_paths(db: Path, as_of: date) -> list[str]:
    """Published contracts dated in the window, as the site addresses them; none when the database is not there
    or cannot be read. Opened read-only: the sample never writes to it."""
    if not db.is_file():
        return []
    first = (as_of - timedelta(days=CONTRACT_DAYS - 1)).isoformat()
    try:
        conn = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error:
        return []
    try:
        rows = conn.execute("SELECT owner_org, reference FROM contracts WHERE contract_date >= ? AND contract_date <= ? "
                            "ORDER BY contract_date DESC LIMIT ?", (first, as_of.isoformat(), CONTRACT_CANDIDATES)).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    out = set()
    for dept, ref in rows:
        dept = str(dept or "").lower()
        ref = str(ref or "")
        if BUYER_ID_RE.match(dept) and len(dept) <= 80 and ref and len(ref) <= REF_MAX and not CONTROL_RE.search(ref):
            out.add(f"/contracts/{component(dept)}/{component(ref)}")
    return sorted(out)


def rank(kind: str, path: str) -> str:
    return hashlib.sha256(f"{SEED}|{kind}|{path}".encode("utf-8")).hexdigest()


def draw(candidates: Mapping[str, list[str]]) -> list[tuple[str, str]]:
    """(kind, path) for the night: each kind's share of its candidates with the lowest rank, kinds in SAMPLE
    order. A kind with fewer candidates than its share gives what it has."""
    out: list[tuple[str, str]] = []
    for kind, share in SAMPLE:
        chosen = sorted(set(candidates.get(kind, [])), key=lambda p: rank(kind, p))[:share]
        out.extend((kind, p) for p in chosen)
    return out


def candidates(static: Path, db: Path) -> dict[str, list[str]]:
    as_of = data_date(static)
    if as_of is None:
        return {}
    return {"tender": tender_paths(static, as_of), "organization": organization_paths(static, as_of),
            "contract": contract_paths(db, as_of)}


# -- one inspection ---------------------------------------------------------------


class Refused(Exception):
    """Google refused the inspection for the whole property (403) or for now (429): the sample stops."""

    def __init__(self, outcome: str, detail: str) -> None:
        super().__init__(detail)
        self.outcome = outcome


def _text(value: Any) -> str:
    return CONTROL_RE.sub(" ", value).strip()[:TEXT_MAX] if isinstance(value, str) else ""


def row_of(day: date, kind: str, path: str, answer: Any, site_url: str) -> dict[str, str] | None:
    """The file's row for one answer, or None when the answer is not an inspection result."""
    result = answer.get("inspectionResult") if isinstance(answer, dict) else None
    status = result.get("indexStatusResult") if isinstance(result, dict) else None
    if not isinstance(status, dict):
        return None
    verdict = status.get("verdict")
    crawl = _text(status.get("lastCrawlTime"))[:10]
    canonical = _text(status.get("googleCanonical")) if isinstance(status.get("googleCanonical"), str) else ""
    if canonical:
        canonical = (urlsplit(canonical).path or "/") if own_page(canonical, site_url) else "another host"
    return {
        "date": day.isoformat(), "kind": kind, "path": path,
        "verdict": verdict if isinstance(verdict, str) and VERDICT_RE.match(verdict) else "",
        "coverage": _text(status.get("coverageState")),
        "robots": _text(status.get("robotsTxtState")),
        "indexing": _text(status.get("indexingState")),
        "fetch": _text(status.get("pageFetchState")),
        "last_crawl": crawl if DATE_RE.match(crawl) else "",
        "google_canonical": canonical[:TEXT_MAX],
    }


def inspect(http: Any, token: str, site: str, url: str, timeout: float = 60) -> Any:
    """Google's answer for one page. Raises Refused on 403 or 429, SearchConsoleError on anything else."""
    body = {"inspectionUrl": url, "siteUrl": site, "languageCode": LANGUAGE}
    try:
        resp = http.post(INSPECT_URL, json=body, headers={"Authorization": f"Bearer {token}",
                                                          "User-Agent": config.USER_AGENT}, timeout=timeout)
    except Exception as exc:
        raise SearchConsoleError(f"inspection failed ({type(exc).__name__})") from None
    status = _status(resp)
    if status == 403:
        raise Refused(NOT_PERMITTED, f"HTTP 403: {_body(resp)}")
    if status == 429:
        raise Refused(RATE_LIMITED, f"HTTP 429: {_body(resp)}")
    if not 200 <= status < 300:
        raise SearchConsoleError(f"inspection HTTP {status}: {_body(resp)}")
    try:
        return resp.json()
    except Exception:
        raise SearchConsoleError(f"inspection HTTP {status} without JSON") from None


# -- the run ----------------------------------------------------------------------


def run(out_dir: Path | None = None, *, env: Mapping[str, str] | None = None, session: Any | None = None,
        now: datetime | None = None, static: Path | None = None, db: Path | None = None,
        sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic) -> str:
    """Inspect tonight's sample. Returns "inspected <n>" (pages Google answered for), "up to date" (tonight's
    sample is in the file already), "no sample", "no credentials", "not permitted", "rate limited" or "failed";
    never raises, and never logs a token."""
    try:
        return _run(out_dir, env=env, session=session, now=now, static=static, db=db, sleep=sleep, clock=clock)
    except Exception as exc:
        log.error("index sample: failed (%s): %s", type(exc).__name__, str(exc)[:200])
        return FAILED


def _run(out_dir: Path | None, *, env: Mapping[str, str] | None, session: Any | None, now: datetime | None,
         static: Path | None, db: Path | None, sleep: Callable[[float], None], clock: Callable[[], float]) -> str:
    source = os.environ if env is None else env
    folder = out_dir or (config.OUT_DIR / "search_console")
    folder.mkdir(parents=True, exist_ok=True)
    secret = (source.get(SECRET_ENV) or "").strip()
    if not secret:
        return NO_CREDENTIALS
    try:
        account = parse_account(secret)
    except ValueError as exc:
        log.error("index sample: %s; nothing inspected", exc)
        return FAILED
    site = site_property(source)
    if not site or not urlsplit(config.SITE_URL).hostname or config.SITE_URL.rstrip("/").endswith(".example"):
        log.error("index sample: no property or site address to inspect; nothing inspected")
        return FAILED
    try:
        held = read_rows(folder / FILE, HEADER)
    except FileError as exc:
        log.error("index sample: %s; nothing inspected, and the file is left as it is", exc)
        return FAILED
    today = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).date()
    if any(r["date"] == today.isoformat() for r in held):
        return UP_TO_DATE
    sample = draw(candidates(static or (config.OUT_DIR / "static"), db or config.DEFAULT_DB))
    if not sample:
        log.info("index sample: no page to sample (the export or the database is not there)")
        return NO_SAMPLE

    origin = config.SITE_URL.rstrip("/")
    if session is None:
        import requests
        http: Any = requests.Session()
    else:
        http = session
    rows: list[dict[str, str]] = []
    skipped = 0
    outcome = ""
    try:
        token = access_token(http, account, int((now or datetime.now(timezone.utc)).timestamp()))
        started = clock()
        for i, (kind, path) in enumerate(sample):
            if clock() - started > BUDGET_S:
                log.info("index sample: the time budget ran out after %d of %d pages", i, len(sample))
                break
            if i:
                sleep(PAUSE_S)
            try:
                row = row_of(today, kind, path, inspect(http, token, site, origin + path), origin)
            except SearchConsoleError as exc:
                log.warning("index sample: one page skipped: %s", str(exc)[:200])
                skipped += 1
                continue
            if row is None:
                skipped += 1
                continue
            rows.append(row)
    except Refused as exc:
        log.error("index sample: %s; stopped after %d pages", exc, len(rows))
        outcome = exc.outcome
    except SearchConsoleError as exc:
        log.error("index sample: %s; nothing inspected", exc)
        return FAILED
    finally:
        if session is None:
            http.close()

    if rows:
        write_rows(folder / FILE, HEADER, held + rows)
    if outcome:
        return outcome
    if not rows:
        return FAILED
    if skipped:
        log.info("index sample: %d pages skipped", skipped)
    return f"inspected {len(rows)}"
