"""Organization merges: one organization filed under several profiles, joined every night on evidence.

Organizations are keyed on the normalized legal name alone, so one business
written two ways that normalize apart ("IBM CANADA LTD." and "IBM CANADA
LIMITED/IBM CANADA LIMITÉE") has two profiles. This step joins them inside the
organizations stage (organizations.run), after the loaders have written the
night's records and before organizations.recompute rebuilds the rows. It
never matches names loosely: a wrong merge is worse than a missing one.

The night's work, in one transaction (apply):

1. Restore. Every record whose organization is not the one its own spelling
   gives (an earlier merge moved it) goes back to that one (migrate.new_id,
   the id organizations.upsert gives at load), so the rules below see each
   organization as its own records name it, whatever was merged before.
2. Clear. A record whose organization is listed in not_organizations.csv
   (organizations.is_not_organization) loses its organization and keeps its
   raw name.
3. Business number. A grant row carries the recipient's business number, and
   an organization whose grant rows all agree on one has it
   (organizations._business_numbers). Organizations sharing a number are one
   when a second fact agrees: a word of their normalized names in common (one
   of three letters or more that is not a generic business word, a place
   word or a legal form: matching.GENERIC_WORDS) or a city or postal code in
   common on their records. The number alone is not enough: some grant rows
   carry another recipient's number (in the Dairy Processing Investment Fund
   rows of 2019-2020, Saputo Foods Limited of Saint-Laurent and a cheese maker
   of Saint-Jean-sur-Richelieu share one), and an organization that shares a
   number and nothing else is listed for review instead. The published
   contracts, the CanadaBuys files and the lobbying reports carry no business
   number, and the federal corporations extract reaches an organization only
   through a name match, so neither is read here. The survivor is the
   survivor of the night before when it is still in the group, else the
   organization with the most records (rows across every record table), then
   the longer normalized name, then the lower id; the others join it when they
   agree with it or with one that already joined.
4. Truncation. Some departments cut a vendor's name in the published
   contracts at CUT characters: among the organizations that only have
   published contracts, 4,559 names are 35 characters long on 2026-11-01,
   against about 2,500 at each length just under it and 835 at 36. An
   organization with published contracts whose every spelling has exactly CUT
   characters and ends in no legal form is a cut name. Its candidates are the
   organizations whose normalized name continues its own in the middle of a
   word (its normalized name is a prefix of theirs and their next character is
   not a space) and, when its last word is the start of a legal form ("Canada
   C" of "Canada Co."), the one named by its normalized name without that
   word. Exactly one candidate, after the merges above, takes it in. A cut
   name with several candidates, or with a candidate that names a joint
   venture when it does not, stays apart and is listed for review. A name cut
   at a word boundary reads like a whole name ("THE BELL TELEPHONE COMPANY
   OF") and is left to the seed.
5. Seed. awardwatch_pipeline/data/organization_aliases.csv (from_norm, to_norm,
   reason), reviewed by hand, is applied last: from_norm's organization joins
   to_norm's. A row with an empty to_norm keeps from_norm out of rules 3 and 4.

Each organization merged away becomes a row of organization_aliases (old_id,
new_id, reason), which the export writes as aliases/<abc>.json so a link to
its old profile is sent on. Its records move to the survivor, whose profile
lists their spellings among its other spellings (organization_names, rebuilt
from the records by recompute). Every merge, and every organization left
apart for review, is written to data/out/review/organization-merges.txt for
the operator; that file is never published.

Stable: the survivor of the night before (its alias rows are the only memory
of it) stays the survivor while it is in its group, and a cut name keeps the
organization it joined while that one is still among its candidates.
Reversible: the merges are rebuilt from the records every night, so one whose
evidence is gone (a seed row deleted, a business number corrected upstream) is
undone on the next run, its records back under their own id and its alias row
deleted. Deleting an alias row by hand makes the next run decide that group
afresh (the survivor by records again); a merge whose evidence still holds
comes back, and a seed row with an empty to_norm is what stops it.
"""

from __future__ import annotations

import bisect
import csv
import logging
import re
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from . import config, organizations
from .db import now_iso
from .migrate import ID_COLUMNS, new_id
from .normalize import LEGAL_SUFFIXES, NORMALIZE_VERSION, has_legal_form, norm_name, org_id, slugify, squash
from .sources.matching import GENERIC_WORDS

log = logging.getLogger(__name__)

# The length at which the published contracts cut a vendor's name (measured; see the module docstring).
CUT = 35
SEED_PATH = config.PACKAGE_DATA / "organization_aliases.csv"
REVIEW_FILE = "organization-merges.txt"
REASONS = ("business_number", "truncation", "seed")
# The start of a legal form, as a cut leaves it at the end of a name: "c" of "co", "in" of "inc", "limi" of "limited".
SUFFIX_STARTS = frozenset(s[:i] for s in LEGAL_SUFFIXES for i in range(1, len(s)))
# A candidate naming a joint venture is never taken by a cut name that does not name one.
JOINT_RE = re.compile(r"\b(?:joint venture|jointventure|coentreprise|consortium|jv)\b")
TEMP_TABLES = ("merge_ids", "merge_map")
# Words that name no one organization, besides matching.GENERIC_WORDS.
STOP_WORDS = frozenset({"the", "of", "for", "and", "et", "de", "la", "le", "les", "du", "des", "an", "in", "on", "at",
                        "to", "canada", "canadian", "canadien", "canadienne"})
# The places on the records of the organizations in temp.merge_ids: (organization, city, postal code).
PLACE_SQL = (
    "SELECT organization_id, supplier_city, supplier_postal FROM awards "
    "WHERE organization_id IN (SELECT id FROM temp.merge_ids) GROUP BY 1, 2, 3",
    "SELECT organization_id, supplier_city, supplier_postal FROM contract_history "
    "WHERE organization_id IN (SELECT id FROM temp.merge_ids) GROUP BY 1, 2, 3",
    "SELECT organization_id, NULL, vendor_postal FROM contracts "
    "WHERE organization_id IN (SELECT id FROM temp.merge_ids) GROUP BY 1, 3",
    "SELECT organization_id, city, postal_code FROM grants "
    "WHERE organization_id IN (SELECT id FROM temp.merge_ids) GROUP BY 1, 2, 3",
)


@dataclass(frozen=True)
class Merge:
    from_id: str
    to_id: str            # the survivor, after every merge of the night
    reason: str           # business_number | truncation | seed
    evidence: str         # the business number, the cut spelling, or the seed row's reason


@dataclass
class Outcome:
    merges: list[Merge] = field(default_factory=list)
    names: dict[str, str] = field(default_factory=dict)       # display names, as the records name each
    records: dict[str, int] = field(default_factory=dict)     # each organization's own records
    review: list[str] = field(default_factory=list)           # organizations left apart for review, one line each
    unapplied: list[str] = field(default_factory=list)        # seed rows that name no organization
    restored: int = 0
    cleared: int = 0
    moved: int = 0

    def counts(self) -> dict[str, int]:
        by = Counter(m.reason for m in self.merges)
        return {"merged": len(self.merges), **{f"merged_{r}": by.get(r, 0) for r in REASONS},
                "merge_review": len(self.review), "records_moved": self.moved, "not_organizations": self.cleared}


def read_seed(path: Path | None = None) -> tuple[list[tuple[str, str, str]], set[str]]:
    """The seed's merges (from_norm, to_norm, reason) and the names it keeps apart (rows with no to_norm)."""
    rows: list[tuple[str, str, str]] = []
    apart: set[str] = set()
    p = path or SEED_PATH
    if not p.exists():
        return rows, apart
    with p.open(encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            # Written normalized; normalizing again is a no-op on a normalized name and
            # forgives a row typed as the name is published.
            src, dst = norm_name(squash(r.get("from_norm"))), norm_name(squash(r.get("to_norm")))
            if not src:
                continue
            if not dst:
                apart.add(src)
            elif dst != src:
                rows.append((src, dst, squash(r.get("reason"))))
    return rows, apart


def _ids_table(conn: sqlite3.Connection, ids: Iterable[str]) -> None:
    conn.execute("DROP TABLE IF EXISTS temp.merge_ids")
    conn.execute("CREATE TEMP TABLE merge_ids (id TEXT PRIMARY KEY)")
    conn.executemany("INSERT OR IGNORE INTO temp.merge_ids (id) VALUES (?)", [(i,) for i in ids])


def _drop_temp(conn: sqlite3.Connection) -> None:
    for name in TEMP_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS temp.{name}")


def _previous(conn: sqlite3.Connection) -> dict[str, tuple[str, str]]:
    """Last night's merges: old id -> (survivor, reason)."""
    return {r[0]: (r[1], r[2]) for r in conn.execute(
        "SELECT old_id, new_id, reason FROM organization_aliases WHERE reason IS NOT NULL")}


def _restore(conn: sqlite3.Connection, stamp: str) -> int:
    """Move every record whose organization is not the one its own spelling gives back to that one.

    Read from the records, not from the aliases, so a merge is undone even
    when its alias row was deleted by hand: each distinct pair of organization
    and spelling is normalized once (about 20 microseconds a spelling).
    """
    moved = 0
    made: set[str] = set()
    for table, column in ID_COLUMNS:
        moves: list[tuple[str, str, str]] = []
        # The moves are collected first and made after: the table is not written while it is read.
        for current, raw in conn.execute(f"SELECT DISTINCT organization_id, {column} FROM {table} "
                                         f"WHERE organization_id IS NOT NULL AND {column} IS NOT NULL"):
            oid = new_id(raw)[0]
            if oid and oid != current:
                moves.append((oid, current, raw))
        for oid, current, raw in moves:
            if oid not in made:
                # Its row went with the merge; recompute fills it in again if it stays apart.
                text = new_id(raw)[1]
                conn.execute("INSERT INTO organizations (id, display_name, norm_name, updated_at) VALUES (?, ?, ?, ?) "
                             "ON CONFLICT(id) DO NOTHING", (oid, text, norm_name(text), stamp))
                made.add(oid)
            moved += conn.execute(f"UPDATE {table} SET organization_id = ? WHERE organization_id = ? AND {column} = ?",
                                  (oid, current, raw)).rowcount
    return moved


def _clear_not_organizations(conn: sqlite3.Connection) -> int:
    """Records whose organization is not one keep their raw name and lose the organization."""
    gone = [oid for oid, norm in conn.execute("SELECT id, norm_name FROM organizations")
            if organizations.is_not_organization(norm)]
    if not gone:
        return 0
    _ids_table(conn, gone)
    cleared = 0
    for table in organizations.RECORD_TABLES:
        cleared += conn.execute(f"UPDATE {table} SET organization_id = NULL "
                                "WHERE organization_id IN (SELECT id FROM temp.merge_ids)").rowcount
    return cleared


def _record_counts(conn: sqlite3.Connection) -> Counter[str]:
    counts: Counter[str] = Counter()
    for table in organizations.RECORD_TABLES:
        for oid, n in conn.execute(f"SELECT organization_id, COUNT(*) FROM {table} "
                                   "WHERE organization_id IS NOT NULL GROUP BY organization_id"):
            counts[oid] += n
    return counts


def _cut_names(conn: sqlite3.Connection, live: set[str]) -> dict[str, list[str]]:
    """The organizations with published contracts whose every spelling has CUT characters and no legal form."""
    span: dict[str, list[int]] = {}
    for table, column in ID_COLUMNS:
        for oid, low, high in conn.execute(
                f"SELECT organization_id, MIN(length({column})), MAX(length({column})) FROM {table} "
                f"WHERE organization_id IS NOT NULL AND {column} IS NOT NULL GROUP BY organization_id"):
            have = span.setdefault(oid, [low, high])
            have[0], have[1] = min(have[0], low), max(have[1], high)
    in_contracts = {r[0] for r in conn.execute("SELECT DISTINCT organization_id FROM contracts "
                                               "WHERE organization_id IS NOT NULL")}
    candidates = sorted(o for o, (low, high) in span.items() if low == high == CUT and o in in_contracts and o in live)
    if not candidates:
        return {}
    _ids_table(conn, candidates)
    spellings: dict[str, set[str]] = defaultdict(set)
    for table, column in ID_COLUMNS:
        for oid, raw in conn.execute(f"SELECT DISTINCT organization_id, {column} FROM {table} "
                                     "WHERE organization_id IN (SELECT id FROM temp.merge_ids)"):
            if raw:
                spellings[oid].add(raw)
    return {oid: sorted(s) for oid, s in spellings.items() if not any(has_legal_form(x) for x in s)}


class _Forest:
    """The merges decided so far: each organization merged away points at the one that took it in."""

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}
        self.link: dict[str, tuple[str, str]] = {}

    def root(self, oid: str) -> str:
        while oid in self.parent:
            oid = self.parent[oid]
        return oid

    def join(self, child: str, into: str, reason: str, evidence: str) -> None:
        a, b = self.root(child), self.root(into)
        if a != b:
            self.parent[a] = b
            self.link[a] = (reason, evidence)


def _words(norm: str) -> frozenset[str]:
    """The words of a normalized name that tell one organization from another."""
    return frozenset(w for w in norm.split() if len(w) >= 3 and not w.isdigit() and w not in GENERIC_WORDS
                     and w not in STOP_WORDS and w not in LEGAL_SUFFIXES)


def _places(conn: sqlite3.Connection, ids: list[str]) -> dict[str, set[str]]:
    """The cities and postal codes on each organization's own records (city:<slug>, postal:<code>)."""
    _ids_table(conn, ids)
    out: dict[str, set[str]] = defaultdict(set)
    for sql in PLACE_SQL:
        for oid, city, postal in conn.execute(sql):
            if city and slugify(city):
                out[oid].add("city:" + slugify(city))
            if postal and squash(postal):
                out[oid].add("postal:" + squash(postal).upper().replace(" ", ""))
    return out


def _by_business_number(forest: _Forest, numbers: dict[str, str], live: set[str], apart: set[str],
                        rank: dict[str, tuple], earlier: set[str], norms: dict[str, str],
                        places: dict[str, set[str]], names: dict[str, str], records: Counter[str]) -> list[str]:
    groups: dict[str, list[str]] = defaultdict(list)
    for oid, bn in numbers.items():
        if oid in live and oid not in apart:
            groups[bn].append(oid)
    review: list[str] = []

    def agree(a: str, b: str) -> bool:
        return bool(_words(norms.get(a, "")) & _words(norms.get(b, "")) or places.get(a, set()) & places.get(b, set()))

    for bn in sorted(groups):
        members = groups[bn]
        if len(members) < 2:
            continue
        pool = [m for m in members if m in earlier] or members
        survivor = min(pool, key=rank.__getitem__)
        joined, waiting = [survivor], sorted(m for m in members if m != survivor)
        grew = True
        while grew and waiting:
            grew = False
            for m in list(waiting):
                if any(agree(m, j) for j in joined):
                    forest.join(m, survivor, "business_number", bn)
                    joined.append(m)
                    waiting.remove(m)
                    grew = True
        for m in waiting:
            review.append(f"{m}\t{names.get(m, '')}\t{records.get(m, 0)}\tbusiness number {bn} shared with no word "
                          f"or place in common\t{survivor} {names.get(survivor, '')}")
    return review


def _by_truncation(forest: _Forest, cuts: dict[str, list[str]], norms: dict[str, str], live: set[str],
                   apart: set[str], previous: dict[str, tuple[str, str]], names: dict[str, str],
                   records: Counter[str]) -> list[str]:
    keys = sorted((n, o) for o, n in norms.items() if o in live and o not in apart and n)
    sorted_norms = [n for n, _ in keys]
    review: list[str] = []
    # The longest first, so a cut of a cut ("... CANADA, I" of "... Canada In") resolves through the shorter one.
    for oid in sorted(cuts, key=lambda o: (-len(norms.get(o, "")), o)):
        if oid in apart or oid in forest.parent:
            continue
        own = norms.get(oid, "")
        candidates: set[str] = set()
        i = bisect.bisect_left(sorted_norms, own)
        while i < len(keys) and sorted_norms[i].startswith(own):
            other, cand = keys[i]
            if len(other) > len(own) and other[len(own)] != " ":
                candidates.add(cand)
            i += 1
        words = own.split()
        if len(words) > 1 and words[-1] in SUFFIX_STARTS:
            base = org_id(" ".join(words[:-1]))
            if base in live and base not in apart:
                candidates.add(base)
        candidates.discard(oid)
        if not candidates:
            continue
        home = forest.root(oid)
        roots = {forest.root(c) for c in candidates} - {home}
        if not roots:
            continue
        joint = not JOINT_RE.search(own) and any(JOINT_RE.search(norms[c]) for c in candidates)
        before = previous.get(oid)
        if before and before[1] == "truncation" and forest.root(before[0]) in roots:
            chosen = forest.root(before[0])
        elif len(roots) == 1 and not joint:
            chosen = next(iter(roots))
        else:
            why = "a candidate names a joint venture" if joint and len(roots) == 1 else f"{len(roots)} candidates"
            shown = "; ".join(f"{c} {names.get(c, '')}" for c in sorted(roots))
            review.append(f"{oid}\t{names.get(oid, '')}\t{records.get(oid, 0)}\t{why}\t{shown}")
            continue
        forest.join(oid, chosen, "truncation", cuts[oid][0])
    return review


def apply(conn: sqlite3.Connection, *, now: str | None = None, seed_path: Path | None = None) -> Outcome:
    """Restore, clear, decide the night's merges and move the records; the caller commits (organizations.run)."""
    stamp = now or now_iso()
    outcome = Outcome()
    previous = _previous(conn)
    try:
        outcome.restored = _restore(conn, stamp)
        outcome.cleared = _clear_not_organizations(conn)
        records = _record_counts(conn)
        live = set(records)
        norms = {oid: n for oid, n in conn.execute("SELECT id, norm_name FROM organizations") if oid in live}
        names = {oid: n for oid, n in conn.execute("SELECT id, display_name FROM organizations") if oid in live}
        seed, apart_names = read_seed(seed_path)
        apart = {org_id(n) for n in apart_names}
        rank = {oid: (-records[oid], -len(norms.get(oid, "")), oid) for oid in live}
        earlier = {new for new, _ in previous.values()}

        forest = _Forest()
        numbers = organizations._business_numbers(conn)
        shared = Counter(bn for oid, bn in numbers.items() if oid in live)
        places = _places(conn, sorted(oid for oid, bn in numbers.items() if shared[bn] > 1 and oid in live))
        outcome.review = _by_business_number(forest, numbers, live, apart, rank, earlier, norms, places, names, records)
        outcome.review += _by_truncation(forest, _cut_names(conn, live), norms, live, apart, previous, names, records)
        for src, dst, reason in seed:
            a, b = org_id(src), org_id(dst)
            if a not in live or b not in live:
                outcome.unapplied.append(f"{src}\t{dst}\t{'from_norm' if a not in live else 'to_norm'} names "
                                         "no organization with records")
                continue
            forest.join(a, b, "seed", reason)

        final = {oid: forest.root(oid) for oid in forest.parent}
        outcome.merges = [Merge(oid, final[oid], *forest.link[oid]) for oid in sorted(final)]
        outcome.names = {oid: names.get(oid, "") for oid in {*final, *final.values()}}
        outcome.records = {oid: records.get(oid, 0) for oid in outcome.names}
        outcome.moved = _move(conn, final)
        _aliases(conn, outcome.merges, previous, live, stamp)
    finally:
        _drop_temp(conn)
    return outcome


def _move(conn: sqlite3.Connection, final: dict[str, str]) -> int:
    conn.execute("DROP TABLE IF EXISTS temp.merge_map")
    conn.execute("CREATE TEMP TABLE merge_map (from_id TEXT PRIMARY KEY, to_id TEXT NOT NULL)")
    conn.executemany("INSERT INTO temp.merge_map (from_id, to_id) VALUES (?, ?)", sorted(final.items()))
    moved = 0
    for table in organizations.RECORD_TABLES:
        moved += conn.execute(
            f"UPDATE {table} SET organization_id = (SELECT m.to_id FROM temp.merge_map m "
            f"WHERE m.from_id = {table}.organization_id) "
            "WHERE organization_id IN (SELECT from_id FROM temp.merge_map)").rowcount
    return moved


def _aliases(conn: sqlite3.Connection, merges: list[Merge], previous: dict[str, tuple[str, str]], live: set[str],
             stamp: str) -> None:
    """Write tonight's merges as aliases; delete an earlier merge's alias once its id has records of its own again."""
    rows = [(m.from_id, m.to_id, NORMALIZE_VERSION, stamp, m.reason) for m in merges
            if previous.get(m.from_id) != (m.to_id, m.reason)]
    conn.executemany(
        "INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at, reason) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(old_id) DO UPDATE SET new_id = excluded.new_id, normalize_version = excluded.normalize_version, "
        "created_at = excluded.created_at, reason = excluded.reason", rows)
    tonight = {m.from_id for m in merges}
    undone = [(old,) for old in previous if old not in tonight and old in live]
    conn.executemany("DELETE FROM organization_aliases WHERE old_id = ? AND reason IS NOT NULL", undone)


def write_review(outcome: Outcome, path: Path, *, stamp: str) -> str | None:
    """Write (or, with nothing to list, remove) the operator's list of merges; returns the log's notice."""
    if not outcome.merges and not outcome.review and not outcome.unapplied:
        path.unlink(missing_ok=True)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    by = Counter(m.reason for m in outcome.merges)
    lines = [
        f"# Organization merges, run of {stamp}: {len(outcome.merges)} organizations merged into others "
        f"({', '.join(f'{r} {by.get(r, 0)}' for r in REASONS)}). For the operator: no step publishes this file.",
        "# A wrong merge is stopped by a row in awardwatch_pipeline/data/organization_aliases.csv with this",
        "# organization's normalized name as from_norm and an empty to_norm.",
        "# reason\tfrom_id\tfrom_name\tfrom_records\tto_id\tto_name\tto_records\tevidence",
    ]
    for m in sorted(outcome.merges, key=lambda m: (REASONS.index(m.reason), m.to_id, m.from_id)):
        lines.append("\t".join((m.reason, m.from_id, outcome.names.get(m.from_id, ""),
                                str(outcome.records.get(m.from_id, 0)), m.to_id, outcome.names.get(m.to_id, ""),
                                str(outcome.records.get(m.to_id, 0)), m.evidence)))
    if outcome.review:
        lines += [f"# Not merged, for review: {len(outcome.review)} organizations, each a name cut at {CUT} characters "
                  "with no single candidate or one sharing a business number and nothing else. A seed row merges one "
                  "by hand.",
                  "# id\tname\trecords\twhy\tcandidates"]
        lines += sorted(outcome.review)
    if outcome.unapplied:
        lines += [f"# Seed rows not applied: {len(outcome.unapplied)}", "# from_norm\tto_norm\twhy"]
        lines += outcome.unapplied
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        shown = path.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        shown = str(path)
    return (f"{len(outcome.merges)} organizations merged into others "
            f"({', '.join(f'{r} {by.get(r, 0)}' for r in REASONS)}), {len(outcome.review)} left for review, "
            f"{len(outcome.unapplied)} seed rows not applied; listed in {shown}")
