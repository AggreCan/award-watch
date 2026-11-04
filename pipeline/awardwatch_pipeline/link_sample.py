"""Nightly link sampling: a sample of the government pages the site links to, checked once a night.

Every record page links to the government's own record of it (CLAUDE.md rule
8): the CanadaBuys notice, the contracts or grants search, the lobbying
registry's report, the dataset on open.canada.ca. A publisher that moves or
withdraws pages breaks those links without saying so. A small sample each
night finds a changed address scheme (every link of its kind answers 404)
the night it happens, and a single withdrawn page within weeks, for about
forty requests.

The kinds (KINDS), each with the address the site builds for it
(site/src/pages/shared.tsx, data.tsx, buyers.tsx):

  tender    a CanadaBuys tender notice page, English or French host
  award     a CanadaBuys award notice page, English or French host
  contract  the contracts search for a published contract's reference
  grant     a grant or contribution's record page in the grants search
  lobbying  a communication report in the Registry of Lobbyists
  portal    open.canada.ca: the source datasets' pages (a contract history
            record links to the history dataset, having no page of its own)
            and the listed buyers' organization pages

Published contracts, grants and lobbying reports are drawn only from rows
with an organization, the ones a profile shows.

The sample: SAMPLE_SIZE links, dealt one kind at a time in KINDS order, so
each kind gets an even share and a kind with fewer links than its share
passes the rest on. Each kind draws with its own random.Random seeded by the
data date and the kind's name: the same database on the same data date
draws the same links in the same order, and a kind added later leaves the
others' draws as they were. A table kind draws a random rowid and takes the
first row at or after it (wrapping round) whose record is not drawn yet, so
a draw never reads a whole table of a million rows.

The requests: one at a time, in the dealt order (the kinds alternate, so
the hosts do too), at least config.DEFAULT_DELAY seconds between two
requests to one host, the pipeline's user agent, a TIMEOUT_S timeout,
redirects followed. HEAD first; a GET whose body is never read when HEAD
answers 405 or 501, since some servers answer HEAD with those. One retry at
most, after RETRY_WAIT_S, and only when no answer came or the answer was 429
or 5xx; a Retry-After longer than RETRY_MAX_WAIT_S is honoured by not asking
again tonight. No check starts after BUDGET_S, so the run records what it
checked before the workflow step's ten-minute limit.

A link is broken when its final answer is 404 or 410 (BROKEN). A 403, a 429
or a 5xx says the host refused or failed tonight, not that the page is gone,
and no answer at all is counted apart. Each check is a row of link_checks
(schema.sql), kept RETENTION_DAYS days; data/out/links/last_outcome.txt
reads "checked N, M broken", and broken.json lists the broken links with
their kinds and record references for the run status (nightly.py) and the
item needing attention (resilience.py). The site keeps its own links
whatever the answer, since a government page may come back.
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import sqlite3
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

import requests

from . import config
from .db import connect, get_meta, now_iso, today_iso
from .feeds import notice_path
from .http import _close, _header, retry_after_seconds

log = logging.getLogger(__name__)

COMMAND = "link-sample"
OUTCOME = "last_outcome.txt"            # under data/out/links, read by `nightly status`
BROKEN_FILE = "broken.json"             # the same folder

SAMPLE_SIZE = 40
TIMEOUT_S = 10.0
ATTEMPTS = 2                            # the first request and one retry
RETRY_WAIT_S = 5.0
RETRY_MAX_WAIT_S = 30.0
# Ten minutes is the step's limit; the slowest single check (two attempts of
# HEAD then GET, each up to the timeout, and the longest wait between) takes
# about 70 seconds, so eight minutes leaves room to finish it and write the
# results.
BUDGET_S = 480.0
RETENTION_DAYS = 60
BROKEN = frozenset({404, 410})
# HEAD answered with these means the server does not take HEAD there.
GET_INSTEAD = frozenset({405, 501})

# The datasets the Data page and the record pages link to (config holds the
# loaders' ids; the federal corporations extract is linked from the Data
# page only).
DATASETS = {
    "tenders": config.TENDERS_DATASET,
    "awards": config.AWARDS_DATASET,
    "history": config.HISTORY_DATASET,
    "contracts": config.CONTRACTS_DATASET,
    "grants": config.GRANTS_DATASET,
    "lobbying": config.LOBBYING_DATASET,
    "registry": "0032ce54-c5dd-4b66-99a0-320a7b5e99f2",
}
LANGS = ("en", "fr")


# -- the addresses, as site/src/pages/shared.tsx builds them -----------------------


def _component(text: str) -> str:
    """encodeURIComponent: the characters it leaves alone are these and the unreserved set."""
    return quote(text, safe="!*'()")


def tender_url(reference: str, lang: str = "en") -> str:
    path = notice_path(reference)
    if lang == "fr":
        return f"https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/{path}"
    return f"https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/{path}"


def award_url(reference: str, lang: str = "en") -> str:
    path = notice_path(reference)
    if lang == "fr":
        return f"https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/{path}"
    return f"https://canadabuys.canada.ca/en/tender-opportunities/award-notice/{path}"


def contract_url(reference: str) -> str:
    return f"https://search.open.canada.ca/contracts/?search_text={_component(reference)}"


def grant_url(owner_org: str, reference: str) -> str:
    return f"https://search.open.canada.ca/grants/record/{_component(f'{owner_org},{reference},current')}"


def lobbying_url(comm_number: str) -> str:
    return f"https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/cmmLgPblcVw?comlogId={_component(comm_number)}"


def dataset_url(dataset_id: str, lang: str = "en") -> str:
    return f"https://open.canada.ca/data/{'fr' if lang == 'fr' else 'en'}/dataset/{dataset_id}"


def organization_url(ckan_org: str, lang: str = "en") -> str:
    return f"https://open.canada.ca/data/{'fr' if lang == 'fr' else 'en'}/organization/{_component(ckan_org)}"


# -- the kinds and the draw ---------------------------------------------------------


@dataclass(frozen=True)
class Link:
    kind: str
    ref: str                    # the record the link belongs to
    url: str


@dataclass(frozen=True)
class TableKind:
    name: str
    table: str
    columns: str                # what build reads
    where: str                  # the rows the site links
    ref: Callable[[sqlite3.Row], str]
    build: Callable[[sqlite3.Row, str], str]
    bilingual: bool = False     # the site links an English and a French address


TABLE_KINDS = (
    TableKind("tender", "tenders", "reference", "reference IS NOT NULL AND reference != ''",
              lambda r: r["reference"], lambda r, lang: tender_url(r["reference"], lang), bilingual=True),
    TableKind("award", "awards", "reference", "reference IS NOT NULL AND reference != ''",
              lambda r: r["reference"], lambda r, lang: award_url(r["reference"], lang), bilingual=True),
    TableKind("contract", "contracts", "owner_org, reference", "organization_id IS NOT NULL AND reference != ''",
              lambda r: f"{r['owner_org']}:{r['reference']}", lambda r, lang: contract_url(r["reference"])),
    TableKind("grant", "grants", "owner_org, reference", "organization_id IS NOT NULL AND reference != ''",
              lambda r: f"{r['owner_org']}:{r['reference']}", lambda r, lang: grant_url(r["owner_org"], r["reference"])),
    TableKind("lobbying", "lobbying_communications", "comm_number",
              "organization_id IS NOT NULL AND comm_number != ''",
              lambda r: r["comm_number"], lambda r, lang: lobbying_url(r["comm_number"])),
)
KINDS = tuple(k.name for k in TABLE_KINDS) + ("portal",)


def _rng(data_date: str, kind: str) -> random.Random:
    return random.Random(f"link-sample:{data_date}:{kind}")


def _first_new(conn: sqlite3.Connection, kind: TableKind, start: int, seen: set[str]) -> sqlite3.Row | None:
    """The first row at or after rowid start, wrapping round to the table's start,
    whose record is not drawn yet; None when every linked record is drawn."""
    base = f"SELECT rowid, {kind.columns} FROM {kind.table} WHERE ({kind.where})"
    for sql in (f"{base} AND rowid >= ? ORDER BY rowid", f"{base} AND rowid < ? ORDER BY rowid"):
        for row in conn.execute(sql, (start,)):
            if kind.ref(row) not in seen:
                return row
    return None


def _table_links(conn: sqlite3.Connection, kind: TableKind, rng: random.Random) -> Iterator[Link]:
    try:
        lo, hi = conn.execute(f"SELECT MIN(rowid), MAX(rowid) FROM {kind.table}").fetchone()
    except sqlite3.Error as exc:
        log.warning("link-sample: %s: the table cannot be read (%s)", kind.name, exc)
        return
    if lo is None:
        return
    seen: set[str] = set()
    while True:
        row = _first_new(conn, kind, rng.randint(lo, hi), seen)
        if row is None:
            return
        ref = kind.ref(row)
        seen.add(ref)
        lang = rng.choice(LANGS) if kind.bilingual else "en"
        yield Link(kind.name, ref, kind.build(row, lang))


def portal_candidates(conn: sqlite3.Connection) -> list[Link]:
    """The open.canada.ca pages the site links: each source dataset and each listed
    buyer's organization page (export.LISTED_BUYER without its open-notice clause,
    which needs the data date's functions; such a buyer has counts as well),
    in both languages, in a fixed order."""
    out = [Link("portal", f"dataset:{source}", dataset_url(ident, lang))
           for source, ident in DATASETS.items() for lang in LANGS]
    try:
        rows = conn.execute(
            "SELECT id, ckan_org FROM buyers WHERE ckan_org IS NOT NULL AND ckan_org != '' "
            "AND (n_awards > 0 OR n_history > 0 OR n_contracts > 0 OR n_grants > 0) ORDER BY id").fetchall()
    except sqlite3.Error as exc:
        log.warning("link-sample: portal: the buyers cannot be read (%s)", exc)
        rows = []
    out += [Link("portal", f"buyer:{r['id']}", organization_url(r["ckan_org"], lang)) for r in rows for lang in LANGS]
    return out


def _portal_links(conn: sqlite3.Connection, rng: random.Random) -> Iterator[Link]:
    candidates = portal_candidates(conn)
    yield from rng.sample(candidates, len(candidates))


def draw(conn: sqlite3.Connection, data_date: str, size: int = SAMPLE_SIZE) -> list[Link]:
    """The night's sample: size links dealt one kind at a time in KINDS order."""
    sources: dict[str, Iterator[Link]] = {k.name: _table_links(conn, k, _rng(data_date, k.name)) for k in TABLE_KINDS}
    sources["portal"] = _portal_links(conn, _rng(data_date, "portal"))
    links: list[Link] = []
    active = list(KINDS)
    while len(links) < size and active:
        for name in list(active):
            if len(links) >= size:
                break
            link = next(sources[name], None)
            if link is None:
                active.remove(name)
            else:
                links.append(link)
    return links


# -- the requests -------------------------------------------------------------------


@dataclass(frozen=True)
class Check:
    link: Link
    status: int | None          # the final answer after redirects; None when none came
    method: str                 # HEAD, or GET after HEAD answered GET_INSTEAD
    elapsed_ms: int
    attempts: int
    error: str | None           # why no answer came (the exception's name)

    @property
    def broken(self) -> bool:
        return self.status in BROKEN


class Spacer:
    """At least the host's delay between two requests to one host."""

    def __init__(self, sleep: Callable[[float], None], clock: Callable[[], float]) -> None:
        self._sleep = sleep
        self._clock = clock
        self._last: dict[str, float] = {}

    def wait(self, url: str) -> None:
        host = urlsplit(url).hostname or ""
        last = self._last.get(host)
        if last is not None:
            remaining = config.CRAWL_DELAY.get(host, config.DEFAULT_DELAY) - (self._clock() - last)
            if remaining > 0:
                self._sleep(remaining)
        self._last[host] = self._clock()


def check_link(session: Any, link: Link, spacer: Spacer, *, sleep: Callable[[float], None] = time.sleep,
               clock: Callable[[], float] = time.monotonic, timeout: float = TIMEOUT_S) -> Check:
    """One link: HEAD, GET on GET_INSTEAD, one retry when no answer came or the
    answer was 429 or 5xx. Never raises: a fault is a check with no status.
    elapsed_ms is the last attempt's time on the wire, without the waits
    between requests."""
    headers = {"User-Agent": config.USER_AGENT}
    attempt = 0
    while True:
        attempt += 1
        method, status, error, retry_after, elapsed = "HEAD", None, None, None, 0.0
        spacer.wait(link.url)
        started = clock()
        try:
            resp = session.head(link.url, headers=headers, timeout=timeout, allow_redirects=True)
            elapsed += clock() - started
            status = int(resp.status_code)
            retry_after = _header(resp, "Retry-After")
            _close(resp)
            if status in GET_INSTEAD:
                method = "GET"
                spacer.wait(link.url)
                started = clock()
                # stream: only the status is wanted, so the body is never downloaded.
                resp = session.get(link.url, headers=headers, timeout=timeout, allow_redirects=True, stream=True)
                elapsed += clock() - started
                status = int(resp.status_code)
                retry_after = _header(resp, "Retry-After")
                _close(resp)
        except requests.RequestException as exc:
            status, error = None, type(exc).__name__
            elapsed += clock() - started
        except Exception as exc:  # a fault here must cost one check, never the step
            status, error = None, type(exc).__name__
        transient = status is None or status == 429 or status >= 500
        asked = retry_after_seconds(retry_after) if status is not None else None
        if transient and attempt < ATTEMPTS and (asked is None or asked <= RETRY_MAX_WAIT_S):
            sleep(max(RETRY_WAIT_S, asked or 0.0))
            continue
        return Check(link, status, method, max(0, int(round(elapsed * 1000))), attempt, error)


def check_all(session: Any, links: list[Link], *, budget: float = BUDGET_S, sleep: Callable[[float], None] = time.sleep,
              clock: Callable[[], float] = time.monotonic) -> list[Check]:
    """Check links in order, one at a time; none starts once budget seconds have passed."""
    spacer = Spacer(sleep, clock)
    deadline = clock() + budget
    checks: list[Check] = []
    for link in links:
        if clock() >= deadline:
            log.warning("link-sample: the time budget (%.0f s) ran out; %d link(s) not checked",
                        budget, len(links) - len(checks))
            break
        result = check_link(session, link, spacer, sleep=sleep, clock=clock)
        log.info("link-sample: %s %s: %s %s, %d ms%s", link.kind, link.ref,
                 result.status if result.status is not None else result.error, result.method, result.elapsed_ms,
                 f", {result.attempts} attempts" if result.attempts > 1 else "")
        checks.append(result)
    return checks


# -- the record ---------------------------------------------------------------------


def record(conn: sqlite3.Connection, checks: list[Check], data_date: str, checked_at: str) -> int:
    """Write tonight's checks and drop the ones older than RETENTION_DAYS, in one
    transaction. Returns the rows dropped."""
    cutoff = (_parse(checked_at) - timedelta(days=RETENTION_DAYS)).isoformat().replace("+00:00", "Z")
    with conn:
        dropped = conn.execute("DELETE FROM link_checks WHERE checked_at < ?", (cutoff,)).rowcount
        conn.executemany(
            "INSERT INTO link_checks (checked_at, data_date, kind, record_ref, url, method, status, error, elapsed_ms, "
            "attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(checked_at, data_date, c.link.kind, c.link.ref, c.link.url, c.method, c.status, c.error, c.elapsed_ms,
              c.attempts) for c in checks])
    return max(dropped, 0)


def _parse(stamp: str) -> datetime:
    when = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def outcome_text(checks: list[Check], planned: int) -> str:
    """'checked N, M broken', with the links no answer came for and the ones the
    time budget left unchecked added only when there are any."""
    broken = sum(1 for c in checks if c.broken)
    text = f"checked {len(checks)}, {broken} broken"
    unanswered = sum(1 for c in checks if c.status is None)
    if unanswered:
        text += f", {unanswered} with no answer"
    if planned > len(checks):
        text += f", {planned - len(checks)} not checked (time limit)"
    return text


def broken_record(checks: list[Check], data_date: str, checked_at: str) -> dict[str, Any]:
    return {
        "data_date": data_date,
        "checked_at": checked_at,
        "checked": len(checks),
        "broken": [{"kind": c.link.kind, "ref": c.link.ref, "url": c.link.url, "status": c.status}
                   for c in checks if c.broken],
    }


def run(conn: sqlite3.Connection, out_dir: Path, session: Any, *, data_date: str | None = None,
        size: int = SAMPLE_SIZE, budget: float = BUDGET_S, now: str | None = None,
        sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic) -> dict[str, Any]:
    """Draw, check, record, and write the outcome and broken.json. "failed" goes to
    the outcome file first, so a run stopped anywhere reads as failed."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / OUTCOME).write_text("failed\n", encoding="utf-8")
    (out_dir / BROKEN_FILE).unlink(missing_ok=True)
    day = (data_date or get_meta(conn, "data_as_of") or today_iso())[:10]
    links = draw(conn, day, size)
    checks = check_all(session, links, budget=budget, sleep=sleep, clock=clock)
    checked_at = now or now_iso()
    dropped = record(conn, checks, day, checked_at)
    result = broken_record(checks, day, checked_at)
    (out_dir / BROKEN_FILE).write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    outcome = outcome_text(checks, len(links))
    (out_dir / OUTCOME).write_text(outcome + "\n", encoding="utf-8")
    by_kind = {k: sum(1 for link in links if link.kind == k) for k in KINDS}
    log.info("link-sample: data date %s, drawn %s; %s; %d row(s) past %d days dropped",
             day, by_kind, outcome, dropped, RETENTION_DAYS)
    return {"outcome": outcome, "drawn": by_kind, **result}


# -- the command --------------------------------------------------------------------


def add_parser(sub: argparse._SubParsersAction) -> None:
    lp = sub.add_parser(COMMAND, help="check a sample of the government pages the site links to")
    lp.add_argument("--db", default=None, help="SQLite path (default data/awardwatch.sqlite)")
    lp.add_argument("--out", default=None, help=f"folder for {OUTCOME} and {BROKEN_FILE} (default data/out/links)")
    lp.add_argument("--size", type=int, default=SAMPLE_SIZE, help=f"links in the sample (default {SAMPLE_SIZE})")
    lp.add_argument("--budget", type=float, default=BUDGET_S,
                    help=f"seconds after which no check starts (default {BUDGET_S:.0f})")
    lp.add_argument("--data-date", default=None,
                    help="the data date that seeds the draw (default the database's data_as_of), to draw a night again")


def command(args: argparse.Namespace) -> int:
    """0 whatever the links answered: a broken link is a fact about the source,
    reported in the run status, never a failed step."""
    out = Path(args.out) if args.out else config.OUT_DIR / "links"
    conn = connect(args.db)
    session = requests.Session()
    try:
        result = run(conn, out, session, data_date=args.data_date, size=max(args.size, 0), budget=args.budget)
    finally:
        session.close()
        conn.close()
    print(f"{COMMAND}: {result['outcome']}")
    for b in result["broken"]:
        print(f"{COMMAND}: broken: {b['kind']} {b['ref']} ({b['status']}) {b['url']}")
    return 0
