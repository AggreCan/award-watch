"""IndexNow: tell the search engines that take it which pages changed tonight.

Bing and the other engines that share IndexNow (Google does not take it)
otherwise find a changed page only when they crawl it again, and with tens of
thousands of organization and notice pages a crawl takes weeks to come round.
After each nightly deploy the workflow runs `python -m
awardwatch_pipeline.nightly indexnow`, which sends the pages that changed
during the run to api.indexnow.org, the shared endpoint that passes them on to
every participating engine.

The key proves the site sends them. It is not a secret: the protocol has the
site publish it at its root as `<key>.txt` (site/public, served as a static
asset), and an engine fetches that file to check a submission. So it lives
here in the code and the workflow needs no secret.

Which pages: the pages that follow the nightly data (FIXED_PAGES); every
tender notice with a version first seen during the run, and the category
pages those notices fall in; every buyer and organization whose row changed
during the run (organizations.recompute and indicators.compute write
updated_at only when something on the page changed, and a new row gets the
stamp of its insert). At most CAP URLs a night, in that order, the most
recently changed first within each kind; pages beyond the cap wait for the
sitemap, which lists every one with its date.

Nothing here raises. Every answer becomes an outcome the run status records:
"submitted <n> URLs", "rejected (<status>)" (the key file or the payload is
wrong, the one outcome that needs a person), "rate limited", "failed" (the
endpoint could not be reached or answered with server errors twice), "nothing
to send" or "dry run (<n> URLs)".
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Sequence
from urllib.parse import urlsplit

from . import config

log = logging.getLogger("awardwatch_pipeline.indexnow")

# 32 lowercase hex characters, generated once. site/public/<key>.txt holds
# exactly this text (tests/test_indexnow.py checks the two agree). Changing it
# means replacing that file in the same commit.
INDEXNOW_KEY = "5381529054ae7c8eb4a9d8553be9ab6f"

ENDPOINT = "https://api.indexnow.org/indexnow"
# The protocol accepts up to 10,000 URLs per request.
BATCH = 10_000
# A night with more changes than this (the first load, or a weekly complete
# file that touches most organizations) sends the most recent and leaves the
# rest to the sitemap. The engines publish no daily limit; this keeps a night well clear
# of looking like a flood.
CAP = 20_000
TIMEOUT = 30
RETRY_S = 10.0
# The pages whose content follows the nightly data. "/" is the home page.
FIXED_PAGES: tuple[str, ...] = ("/", "/tenders", "/tenders/new", "/awards", "/expiring", "/organizations", "/buyers",
                                "/segments", "/rankings")

ACCEPTED = (200, 202)
# 400 bad request, 403 key not valid, 422 URLs not on the host or a key that
# does not match: sending the same request again cannot help.
REJECTED = (400, 403, 422)
TOO_MANY = 429

OUTCOME_FILE = "last_outcome.txt"
URLS_FILE = "urls.txt"


def normalize_since(text: str | None) -> str:
    """The run's start as organizations.updated_at writes it (YYYY-MM-DDTHH:MM:SSZ,
    UTC), so the two compare as text. A time without a zone is read as UTC.
    Raises ValueError when the text is not an ISO date or time."""
    raw = (text or "").strip()
    if not raw:
        raise ValueError("no start time was given")
    moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def changed_urls(conn: sqlite3.Connection, since: str, site_url: str, *, cap: int = CAP,
                 pages: Sequence[str] = FIXED_PAGES) -> list[str]:
    """The fixed pages, then the tender notices with a version first seen on
    the run's day or later and the categories they fall in, then the buyers
    the export lists and the organizations changed at or after since (the most recently
    changed first, ties by id), without repeats and at most cap in all.
    Raises ValueError for a since that is not ISO, and sqlite3.Error when a
    table cannot be read."""
    from .export import listed_buyer_ids
    from .export_static import read_segments, url_reference

    base = site_url.rstrip("/")
    stamp = normalize_since(since)
    limit = max(cap, 0)
    urls: list[str] = []
    seen: set[str] = set()

    def add(path: str) -> None:
        url = base + path
        if len(urls) < limit and url not in seen:
            seen.add(url)
            urls.append(url)

    for page in pages:
        add(page)
    # first_seen is the run's date (no time), so the day of since is the test.
    segments = read_segments()
    touched: set[str] = set()
    for reference, codes in conn.execute(
        "SELECT t.reference, (SELECT group_concat(c.unspsc, ' ') FROM tender_codes c WHERE c.reference = t.reference "
        "AND c.amendment = t.amendment) FROM tenders t WHERE t.first_seen >= ? "
        "GROUP BY t.reference ORDER BY MAX(t.first_seen) DESC, t.reference LIMIT ?",
        (stamp[:10], limit),
    ):
        ref = url_reference(reference)
        if ref:
            add(f"/tenders/{ref.lower()}")
        touched.update(c[:2] for c in (codes or "").split() if c[:2] in segments)
    for code in sorted(touched):
        add(f"/segments/{code}")
    # Only a buyer the export lists has a page (export.LISTED_BUYER, on the export's data date).
    as_of = (conn.execute("SELECT value FROM meta WHERE key = 'data_as_of'").fetchone() or (stamp[:10],))[0]
    listed = listed_buyer_ids(conn, as_of)
    for table, prefix in (("buyers", "/buyers/"), ("organizations", "/organizations/")):
        for (rid,) in conn.execute(f"SELECT id FROM {table} WHERE updated_at >= ? ORDER BY updated_at DESC, id LIMIT ?",
                                   (stamp, limit)):
            if table != "buyers" or rid in listed:
                add(prefix + rid)
    return urls


def _plural(n: int) -> str:
    return f"{n} URL" if n == 1 else f"{n} URLs"


def _post(http: Any, endpoint: str, body: bytes, headers: dict[str, str], sleep: Callable[[float], None],
          retry_after: float) -> tuple[int | None, str]:
    """(status, note) for one batch. A network error or a 5xx is tried once
    more after retry_after seconds; status is None when no answer came."""
    status: int | None = None
    note = ""
    for attempt in (1, 2):
        try:
            resp = http.post(endpoint, data=body, headers=headers, timeout=TIMEOUT)
            status = int(resp.status_code)
            note = f"HTTP {status}"
        except Exception as exc:
            status, note = None, f"no answer ({type(exc).__name__})"
        if status is not None and status < 500:
            return status, note
        if attempt == 1:
            log.warning("indexnow: %s; trying again in %g s", note, retry_after)
            sleep(retry_after)
    return status, note


def key_file_ok(http: Any, key_location: str, key: str) -> bool:
    """True when the site serves the key file with the key as its content.
    Any failure to fetch it reads as not ok. Never raises."""
    try:
        resp = http.get(key_location, headers={"User-Agent": config.USER_AGENT}, timeout=TIMEOUT)
        return int(resp.status_code) == 200 and str(resp.text).strip() == key
    except Exception:
        return False


def submit(http: Any, urls: Sequence[str], *, key: str, host: str, key_location: str,
           endpoint: str = ENDPOINT, batch_size: int = BATCH, sleep: Callable[[float], None] | None = None,
           retry_after: float | None = None) -> dict[str, Any]:
    """POST the URLs in batches of at most batch_size. Stops at the first
    batch not accepted. Returns the record: outcome, urls (how many were to
    go), accepted (how many the endpoint took), batches, sent (batches
    posted), answers (one note per batch posted) and detail. Never raises."""
    record: dict[str, Any] = {"outcome": "failed", "urls": len(urls), "accepted": 0, "batches": 0,
                              "sent": 0, "answers": [], "detail": ""}
    if not urls:
        record["outcome"] = "nothing to send"
        return record
    wait = sleep or time.sleep
    pause = RETRY_S if retry_after is None else retry_after
    try:
        size = max(int(batch_size), 1)
        batches = [list(urls[i:i + size]) for i in range(0, len(urls), size)]
        record["batches"] = len(batches)
        headers = {"Content-Type": "application/json; charset=utf-8", "User-Agent": config.USER_AGENT}
        for n, batch in enumerate(batches, start=1):
            body = json.dumps({"host": host, "key": key, "keyLocation": key_location, "urlList": batch}).encode("utf-8")
            status, note = _post(http, endpoint, body, headers, wait, pause)
            record["sent"] = n
            record["answers"].append(note)
            if status in ACCEPTED:
                record["accepted"] += len(batch)
                continue
            where = f"batch {n} of {len(batches)}"
            if status in REJECTED and status != 400 and key_file_ok(http, key_location, key):
                # The endpoint refused the key while the site serves it correctly:
                # a key it has not fetched and verified yet (seen on the first
                # night of a new key). Nothing to fix; the next night tries again.
                record["outcome"] = f"not verified ({status})"
                record["detail"] = f"{where} answered {status} although the key file answers correctly; nothing more sent"
            elif status in REJECTED:
                record["outcome"] = f"rejected ({status})"
                record["detail"] = f"{where} answered {status}; nothing more sent"
            elif status == TOO_MANY:
                record["outcome"] = "rate limited"
                record["detail"] = f"{where} answered 429; nothing more sent"
            else:
                record["outcome"] = "failed"
                retried = status is None or status >= 500
                record["detail"] = f"{where}: {note}" + (" on the retry as well" if retried else "")
            return record
        record["outcome"] = f"submitted {_plural(record['accepted'])}"
    except Exception as exc:
        record["outcome"] = "failed"
        record["detail"] = f"the submission itself failed ({type(exc).__name__})"
    return record


def write_outcome(folder: Path, outcome: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / OUTCOME_FILE).write_text(outcome + "\n", encoding="utf-8")


def write_urls(folder: Path, urls: Sequence[str]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / URLS_FILE).write_text("".join(f"{u}\n" for u in urls), encoding="utf-8")


def run(db: Path, since: str | None, site_url: str, out: Path, *, http_factory: Callable[[], Any],
        dry_run: bool = False, key: str = INDEXNOW_KEY, sleep: Callable[[float], None] | None = None,
        retry_after: float | None = None, cap: int | None = None, batch_size: int | None = None) -> dict[str, Any]:
    """Select, send and record. Writes "failed" to the outcome file before
    anything else, so a run stopped part way (its time limit) reads as
    failed, then the real outcome and the URLs selected. Never raises."""
    record: dict[str, Any] = {"outcome": "failed", "urls": 0, "accepted": 0, "batches": 0, "sent": 0,
                              "answers": [], "detail": ""}
    try:
        write_outcome(out, "failed")
        write_urls(out, [])
    except OSError as exc:
        log.warning("indexnow: the outcome file cannot be written (%s)", exc)
    try:
        record = _run(db, since, site_url, out, http_factory, dry_run, key, sleep, retry_after, cap, batch_size)
    except Exception as exc:
        record["detail"] = f"indexnow failed ({type(exc).__name__}: {exc})"[:300]
    try:
        write_outcome(out, record["outcome"])
    except OSError as exc:
        log.warning("indexnow: the outcome file cannot be written (%s)", exc)
    return record


def _run(db: Path, since: str | None, site_url: str, out: Path, http_factory: Callable[[], Any], dry_run: bool,
         key: str, sleep: Callable[[float], None] | None, retry_after: float | None, cap: int | None,
         batch_size: int | None) -> dict[str, Any]:
    def failed(detail: str) -> dict[str, Any]:
        return {"outcome": "failed", "urls": 0, "accepted": 0, "batches": 0, "sent": 0, "answers": [], "detail": detail}

    base = (site_url or "").strip().rstrip("/")
    parts = urlsplit(base)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return failed(f"the site address {site_url!r} has no host")
    try:
        normalize_since(since)
    except ValueError as exc:
        return failed(f"the run's start time {since!r} is not an ISO time ({exc})")
    if not db.exists() or db.stat().st_size == 0:
        return failed(f"{db} is missing or empty")
    conn = sqlite3.connect(str(db))
    try:
        urls = changed_urls(conn, since or "", base, cap=CAP if cap is None else cap)
    except sqlite3.Error as exc:
        return failed(f"the database cannot be read ({exc})"[:300])
    finally:
        conn.close()
    write_urls(out, urls)
    if dry_run:
        return {"outcome": f"dry run ({_plural(len(urls))})", "urls": len(urls), "accepted": 0,
                "batches": 0, "sent": 0, "answers": [], "detail": "nothing sent"}
    http = http_factory()
    try:
        return submit(http, urls, key=key, host=parts.hostname, key_location=f"{base}/{key}.txt",
                      batch_size=BATCH if batch_size is None else batch_size, sleep=sleep, retry_after=retry_after)
    finally:
        close = getattr(http, "close", None)
        if callable(close):
            close()
