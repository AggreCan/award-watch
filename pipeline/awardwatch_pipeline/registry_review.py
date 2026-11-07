"""The registry check of the organization review: a back end for the operator, never shown on the site.

The operator's ruling of 2026-11-07 (number 5): registry lookups beyond the
federal extract run only as a check in the nightly, written to the review
file. For each pair data/out/review/organization-merges.txt lists (each
member of a spelling group beside its group's survivor, each candidate for
the seed: merges.review_pairs), both names are looked up and the pair is
marked:

  "same registry record"  in one registry both names lead to one registration,
                          and no registry says otherwise;
  "different records"     in one registry both lead to a registration and the
                          two differ, and no registry says the same;
  "unknown"               anything else: a name with no registration or with
                          several, a registry neither name reaches, registries
                          that disagree.

A name leads to a registration only when exactly one carries it, so a common
name never decides a pair. The registries:

* The local tables. registry_matches (the federal corporations extract,
  matched by registry_federal on the normalized name), read before the
  organizations stage's rebuild removes a merged-away organization's row;
  for an organization with no such row (merged away the night before, so
  absent when the registry stage matched), the extract itself
  (federal_corporations) by the same normalized name.
* OrgBook BC (config.ORGBOOK_SEARCH, the public topic search of its v4 API,
  documented at orgbook.gov.bc.ca/api). Its OpenAPI description gives the
  data the "Access Only" licence of the BC government: reading is open,
  reproduction needs written permission. So nothing from it is published:
  its answers go to their own cache table (orgbook_lookups), which no export
  reads, never to registry_matches, which profiles export. At most
  config.ORGBOOK_BUDGET searches a night, one at a time, each with
  config.ORGBOOK_TIMEOUT_S to answer and no retry, under the pipeline's user
  agent; a name is searched again only after ORGBOOK_RECHECK_DAYS, so the
  cache works through the list over the nights. Any failure ends the
  night's searches (the pairs keep what the cache and the local tables say).
  The names searched are those of the pairs the local tables leave unknown,
  a pair with a member in British Columbia first.
* Never the Quebec register (sources/registry_quebec.py, which no stage
  runs): its extract is published under CC BY-NC-SA 4.0, and the
  non-commercial clause does not fit a site run for profit with a paid tier,
  so it is not read here even as a private check.

Nothing here reaches the export or the site: the verdicts go to the review
file (merges.write_review) and its headline counts (merges.SUMMARY_FILE).
check never raises: a failure leaves every pair "unknown" and says so in the
counts.
"""

from __future__ import annotations

import logging
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from . import config
from .db import now_iso
from .http import PoliteClient
from .match_key import match_key
from .normalize import norm_name, split_trade_name
from .sources import matching

log = logging.getLogger(__name__)

SAME = "same registry record"
DIFFERENT = "different records"
UNKNOWN = "unknown"
VERDICTS = (SAME, DIFFERENT, UNKNOWN)
FEDERAL = "corporations_canada"
ORGBOOK = "bc_orgbook"
# A searched name is asked for again after this many days (a registration's names change rarely).
ORGBOOK_RECHECK_DAYS = 180
# Only the first results are read: the search ranks by score, and a name's own registration comes first.
ORGBOOK_RESULTS = 10

Registrations = dict[str, dict[str, set[str]]]  # organization -> registry -> registration ids


def orgbook_client(client: PoliteClient | None) -> PoliteClient | None:
    """The client OrgBook is asked through: the run's session and user agent, one attempt per request and no
    second failure (the first one ends the night's searches). None in a samples run, which asks nothing."""
    return client.single_attempt() if client is not None else None


def local_registrations(conn: sqlite3.Connection, ids: Iterable[str], norms: dict[str, str]) -> Registrations:
    """Each organization's registrations in the local tables: its registry_matches rows, and for one with no
    federal row, the federal corporations whose normalized name is its own. Run before the rebuild removes the
    rows of the organizations merged away tonight."""
    wanted = sorted(set(ids))
    out: Registrations = defaultdict(lambda: defaultdict(set))
    for i in range(0, len(wanted), 500):
        chunk = wanted[i:i + 500]
        marks = ",".join("?" * len(chunk))
        for oid, registry, rid in conn.execute(
                f"SELECT organization_id, registry, registry_id FROM registry_matches WHERE organization_id IN ({marks})",
                chunk):
            out[oid][registry].add(str(rid))
    for oid in wanted:
        if FEDERAL in out.get(oid, {}) or not norms.get(oid):
            continue
        numbers = {r[0] for r in conn.execute("SELECT number FROM federal_corporations WHERE norm_name = ?",
                                              (norms[oid],))}
        if numbers:
            out[oid][FEDERAL] |= numbers
    return {oid: {reg: set(ids_) for reg, ids_ in regs.items()} for oid, regs in out.items()}


def snapshot(conn: sqlite3.Connection, outcome) -> Registrations:
    """local_registrations of every organization the review file pairs, inside the organizations stage's
    transaction; empty (every pair then reads from OrgBook's cache alone) rather than a failed stage."""
    from . import merges

    try:
        return local_registrations(conn, (oid for pair in merges.review_pairs(outcome) for oid in pair),
                                   outcome.norms)
    except Exception as exc:
        log.warning("registry check: the local registry rows could not be read: %s", exc)
        return {}


def verdict(a: dict[str, set[str]], b: dict[str, set[str]]) -> tuple[str, str]:
    """The pair's verdict and the registrations that made it ("corporations_canada 1234567 = 1234567")."""
    said: set[str] = set()
    evidence: list[str] = []
    for registry in sorted(set(a) & set(b)):
        ra, rb = a[registry], b[registry]
        if len(ra) != 1 or len(rb) != 1:
            continue  # a name several registrations carry decides nothing
        x, y = next(iter(ra)), next(iter(rb))
        said.add(SAME if x == y else DIFFERENT)
        evidence.append(f"{registry} {x} {'=' if x == y else '/'} {y}")
    return (said.pop() if len(said) == 1 else UNKNOWN), "; ".join(evidence)


def orgbook_match(results: list[dict], query_norm: str, query_text: str = "") -> tuple[str | None, str | None, int]:
    """(registration, its name that matched, how many registrations matched) among the first results: a
    registration matches when one of its names normalizes to the name searched (query_norm) or shares the
    match key of the spelling searched (query_text), the spelling rule's own test."""
    key = match_key(query_text) if query_text else None
    found: dict[str, str] = {}
    for r in results[:ORGBOOK_RESULTS]:
        sid = str(r.get("source_id") or "").strip()
        if not sid:
            continue
        for n in r.get("names") or []:
            text = str((n or {}).get("text") or "").strip()
            if not text:
                continue
            other = match_key(text)
            if norm_name(text) == query_norm or (key and other and other.key == key.key):
                found.setdefault(sid, text)
                break
    if len(found) == 1:
        sid, text = next(iter(found.items()))
        return sid, text, 1
    return None, None, len(found)


def _cached(conn: sqlite3.Connection, queries: Iterable[str]) -> dict[str, sqlite3.Row]:
    wanted = sorted(set(q for q in queries if q))
    out: dict[str, sqlite3.Row] = {}
    for i in range(0, len(wanted), 500):
        chunk = wanted[i:i + 500]
        marks = ",".join("?" * len(chunk))
        for r in conn.execute(f"SELECT query, registration, legal_name, matches, fetched_at FROM orgbook_lookups "
                              f"WHERE query IN ({marks})", chunk):
            out[r[0]] = r
    return out


def _search(client: PoliteClient, name: str) -> list[dict]:
    # inactive=any: a former name sits on an inactive credential, and a rename is what the check is for.
    url = f"{config.ORGBOOK_SEARCH}?{urlencode({'q': name, 'inactive': 'any'})}"
    data = client.get_json(url, timeout=config.ORGBOOK_TIMEOUT_S)
    return list(data.get("results") or []) if isinstance(data, dict) else []


def lookup_orgbook(conn: sqlite3.Connection, client: PoliteClient | None, order: list[str], names: dict[str, str],
                   norms: dict[str, str], *, now: str, budget: int) -> dict[str, int]:
    """Search OrgBook for the organizations in order whose name the cache lacks or holds from before
    ORGBOOK_RECHECK_DAYS, at most budget of them, stopping at the first failure. Returns the counts."""
    stats = {"searched": 0, "failed": 0}
    if client is None or budget <= 0:
        return stats
    cutoff = (datetime.fromisoformat(now.replace("Z", "+00:00")) - timedelta(days=ORGBOOK_RECHECK_DAYS)) \
        .astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    cached = _cached(conn, (norms.get(o, "") for o in order))
    done: set[str] = set()
    for oid in order:
        query = norms.get(oid, "")
        if not query or query in done:
            continue
        done.add(query)
        hit = cached.get(query)
        if hit is not None and hit["fetched_at"] > cutoff:
            continue
        if stats["searched"] >= budget:
            break
        # The legal name is searched: an operating name after "o/a" only adds noise to the search.
        text = split_trade_name(matching.first_language(names.get(oid, "")))[0] or names.get(oid, "")
        stats["searched"] += 1
        try:
            results = _search(client, text)
        except Exception as exc:  # any failure: no more searches tonight, and the run goes on
            stats["failed"] = 1
            log.warning("registry check: OrgBook search stopped after %d: %s", stats["searched"] - 1, exc)
            break
        registration, legal, n = orgbook_match(results, query, text)
        conn.execute(
            "INSERT INTO orgbook_lookups (query, registration, legal_name, matches, fetched_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(query) DO UPDATE SET registration = excluded.registration, legal_name = excluded.legal_name, "
            "matches = excluded.matches, fetched_at = excluded.fetched_at",
            (query, registration, legal, n, now))
        conn.commit()
    return stats


def check(conn: sqlite3.Connection, outcome, local: Registrations, *, client: PoliteClient | None = None,
          now: str | None = None, budget: int | None = None,
          provinces: Callable[[str], set[str]] | None = None) -> None:
    """Mark every pair the review file lists (outcome.registry) and count the verdicts (outcome.registry_counts).

    outcome is the night's merges.Outcome; local is local_registrations of its organizations, read before the
    rebuild. Never raises."""
    from . import merges

    stamp = now or now_iso()
    try:
        pairs = merges.review_pairs(outcome)
        names, norms = outcome.names, outcome.norms
        first = {p: verdict(local.get(p[0], {}), local.get(p[1], {})) for p in pairs}
        places = provinces or (lambda oid: _provinces(conn, oid))
        open_pairs = [p for p in pairs if first[p][0] == UNKNOWN]
        # A pair with a member in British Columbia first: OrgBook is that province's register.
        open_pairs.sort(key=lambda p: not ("BC" in places(p[0]) or "BC" in places(p[1])))
        order = [oid for p in open_pairs for oid in p]
        searched = lookup_orgbook(conn, client, order, names, norms, now=stamp,
                                  budget=config.ORGBOOK_BUDGET if budget is None else budget)
        cached = _cached(conn, (norms.get(o, "") for p in pairs for o in p))

        def registrations(oid: str) -> dict[str, set[str]]:
            regs = {k: set(v) for k, v in local.get(oid, {}).items()}
            hit = cached.get(norms.get(oid, ""))
            if hit is not None and hit["registration"]:
                regs[ORGBOOK] = {hit["registration"]}
            return regs

        counts: Counter[str] = Counter()
        merged = {m.from_id for m in outcome.merges if m.reason == "spelling"}
        for a, b in pairs:
            v, evidence = verdict(registrations(a), registrations(b))
            outcome.registry[(a, b)] = f"{v} ({evidence})" if evidence else v
            counts[v] += 1
            if v == DIFFERENT and a in merged:
                counts["different_merged"] += 1
        outcome.registry_counts = {"pairs": len(pairs), "same": counts[SAME], "different": counts[DIFFERENT],
                                   "unknown": counts[UNKNOWN], "different_merged": counts["different_merged"],
                                   "orgbook_searched": searched["searched"], "orgbook_failed": searched["failed"]}
    except Exception as exc:
        log.warning("registry check failed; every pair reads unknown: %s", exc)
        outcome.registry = {}
        outcome.registry_counts = {"pairs": 0, "same": 0, "different": 0, "unknown": 0, "different_merged": 0,
                                   "orgbook_searched": 0, "orgbook_failed": 0, "failed": 1}


def _provinces(conn: sqlite3.Connection, oid: str) -> set[str]:
    return {r[0] for r in conn.execute("SELECT DISTINCT province FROM organization_places WHERE organization_id = ? "
                                       "AND province != ''", (oid,))}
