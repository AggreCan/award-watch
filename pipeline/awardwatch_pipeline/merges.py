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
5. Spelling. Organizations whose spellings share a match key (match_key.py:
   the first legal name of a spelling, abbreviations expanded, a bracketed
   acronym, a vendor code or the words after a complete legal name left out,
   the name in its other language set aside, spaces removed) are one: "Stantec
   Cnslt.Ltd." and "Stantec Consulting Ltd.", "KPMG LLP, T4348" and "KPMG LLP".
   A spelling naming a joint venture or two companies, a key with no
   distinctive word and an organization with a spelling that reads as a person
   get no key. Run as config.ORG_SPELLING_MERGE says: "shadow" (the default)
   lists the groups it would merge in the review file and merges nothing,
   "on" merges them, "off" leaves the rule out. Each group in the file carries
   its key, the steps that made it (spacing, abbreviation, both languages,
   words after the form, vendor code, acronym), whether a city or postal code
   of the members agrees, their provinces, ids, names and records.
6. Seed. awardwatch_pipeline/data/organization_aliases.csv (from_norm, to_norm,
   reason, note), reviewed by hand, is applied last: from_norm's organization
   joins to_norm's. A row with an empty to_norm keeps from_norm out of rules
   3 to 5 and out of the candidates below. The note (SEED_NOTES: spelling,
   former, short, branch) says what the name is to the one it joins, for a
   profile's "also appears as" line once the export carries it.

After the rules, the review file lists the candidates no rule may merge, for
the seed: names one or two edits apart in a long word (a place in common
first), short forms of one to three longer names, names that end in a place
word, operating names that are another organization's name, and
organizations that hold different amendments of one contract (a likely rename
or assignment). Each comes with the seed row that would merge it.

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
import io
import logging
import re
import sqlite3
from array import array
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from . import config, organizations
from .db import now_iso
from .match_key import STOP_WORDS, Key, distinctive, edit_distance, match_key, strip_places
from .migrate import ID_COLUMNS, new_id
from .normalize import (
    LEGAL_SUFFIXES, NORMALIZE_VERSION, has_legal_form, norm_name, org_id, slugify, split_trade_name, squash,
)
from .sources import matching
from .sources.matching import GENERIC_WORDS

log = logging.getLogger(__name__)

# The length at which the published contracts cut a vendor's name (measured; see the module docstring).
CUT = 35
SEED_PATH = config.PACKAGE_DATA / "organization_aliases.csv"
REVIEW_FILE = "organization-merges.txt"
REASONS = ("business_number", "truncation", "spelling", "seed")
SPELLING_MODES = ("shadow", "on", "off")
SEED_COLUMNS = ("from_norm", "to_norm", "reason", "note")
# What a merged name is to the one it joins: another way of writing it, a
# former name, a short form, a branch or division's name.
SEED_NOTES = ("spelling", "former", "short", "branch")
# The candidates for the seed: the kinds, in the order the review file lists
# them, and the seed note each suggests.
CANDIDATE_KINDS = {"operating": "", "former": "former", "place": "branch", "short": "short", "typo": "spelling"}
# At most this many candidates of each kind are listed (a place in common first, then the largest).
CANDIDATE_LIMIT = 1000
# A typo pair: keys of this many characters or more, and every word that differs this long on both sides
# ("communicatons" for "communications"; not "Ferme Cario" for "Ferme Carlin", two farms).
TYPO_MIN_KEY = 10
TYPO_MIN_WORD = 7
# A short form is listed when it starts this many longer names or fewer; more is a family of firms.
SHORT_MAX = 3
# Names ending in a place word are listed when this many organizations or fewer share the rest.
PLACE_MAX = 6
# The typo search sorts its hashes in this many slices, to bound its memory.
TYPO_PASSES = 4
# The start of a legal form, as a cut leaves it at the end of a name: "c" of "co", "in" of "inc", "limi" of "limited".
SUFFIX_STARTS = frozenset(s[:i] for s in LEGAL_SUFFIXES for i in range(1, len(s)))
# A candidate naming a joint venture is never taken by a cut name that does not name one.
JOINT_RE = re.compile(r"\b(?:joint venture|jointventure|coentreprise|consortium|jv)\b")
TEMP_TABLES = ("merge_ids", "merge_map")
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
    reason: str           # business_number | truncation | spelling | seed
    evidence: str         # the business number, the cut spelling, the key and its steps, or the seed row's reason


@dataclass(frozen=True)
class SeedRow:
    from_norm: str
    to_norm: str
    reason: str
    note: str             # one of SEED_NOTES, or empty


@dataclass
class SpellingGroup:
    """Organizations sharing a match key (the spelling rule), the survivor first."""
    key: str
    steps: tuple[str, ...]
    members: list[str]
    place: str = ""                   # "city", "postal" or "city, postal": what two members have in common
    provinces: dict[str, list[str]] = field(default_factory=dict)

    @property
    def overlap(self) -> str:
        """Whether two members share a province: yes, no, or unknown (fewer than two have one)."""
        seen = [set(p) for p in self.provinces.values() if p]
        if len(seen) < 2:
            return "unknown"
        return "yes" if any(a & b for i, a in enumerate(seen) for b in seen[i + 1:]) else "no"


@dataclass
class Candidate:
    """A pair no rule may merge, listed for the seed: from_id would join to_id."""
    kind: str             # one of CANDIDATE_KINDS
    from_id: str
    to_id: str
    detail: str
    place: str = ""       # what the two have in common: "city", "postal", "city, postal" or ""


@dataclass
class Outcome:
    merges: list[Merge] = field(default_factory=list)
    names: dict[str, str] = field(default_factory=dict)       # display names, as the records name each
    norms: dict[str, str] = field(default_factory=dict)       # normalized names, for the seed rows suggested
    records: dict[str, int] = field(default_factory=dict)     # each organization's own records
    review: list[str] = field(default_factory=list)           # organizations left apart for review, one line each
    unapplied: list[str] = field(default_factory=list)        # seed rows that name no organization or break a rule
    spelling: list[SpellingGroup] = field(default_factory=list)
    spelling_mode: str = "shadow"
    candidates: list[Candidate] = field(default_factory=list)
    restored: int = 0
    cleared: int = 0
    moved: int = 0

    def counts(self) -> dict[str, int]:
        by = Counter(m.reason for m in self.merges)
        return {"merged": len(self.merges), **{f"merged_{r}": by.get(r, 0) for r in REASONS},
                "merge_review": len(self.review), "records_moved": self.moved, "not_organizations": self.cleared,
                "spelling_groups": len(self.spelling), "seed_candidates": len(self.candidates)}


def read_seed(path: Path | None = None) -> tuple[list[SeedRow], set[str], list[str]]:
    """The seed's merges, the names it keeps apart (rows with no to_norm), and the rows it cannot apply.

    Lines starting with '#' are comments. A merge row whose note is not one of
    SEED_NOTES is not applied: it is listed in the review file with the reason,
    and the rest of the seed still applies.
    """
    rows: list[SeedRow] = []
    apart: set[str] = set()
    bad: list[str] = []
    p = path or SEED_PATH
    if not p.exists():
        return rows, apart, bad
    lines = [line for line in p.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")]
    for r in csv.DictReader(io.StringIO("\n".join(lines))):
        # Written normalized; normalizing again is a no-op on a normalized name and
        # forgives a row typed as the name is published.
        src, dst = norm_name(squash(r.get("from_norm"))), norm_name(squash(r.get("to_norm")))
        note = squash(r.get("note")).casefold()
        if not src:
            continue
        if not dst:
            apart.add(src)
        elif note and note not in SEED_NOTES:
            bad.append(f"{src}\t{dst}\tthe note {note!r} is not one of {', '.join(SEED_NOTES)}")
        elif dst != src:
            rows.append(SeedRow(src, dst, squash(r.get("reason")), note))
    return rows, apart, bad


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


def _spellings(conn: sqlite3.Connection, live: set[str]) -> dict[str, set[str]]:
    """Each organization's own legal spellings, as its records write them (operating names are not read)."""
    out: dict[str, set[str]] = defaultdict(set)
    for table, column in ID_COLUMNS:
        for oid, raw in conn.execute(f"SELECT DISTINCT organization_id, {column} FROM {table} "
                                     f"WHERE organization_id IS NOT NULL AND {column} IS NOT NULL"):
            if oid in live:
                out[oid].add(raw)
    return out


# Marks a spelling that reads as a person in _keys' cache.
_PERSON = Key("", (), frozenset())


def _keys(spellings: dict[str, set[str]], apart: set[str]) -> dict[str, list[Key]]:
    """The match keys of each organization's spellings; none for one kept apart by the seed or one with a
    spelling that reads as a person (the loaders withhold those, so it means the person test changed)."""
    cache: dict[str, Key | None] = {}
    out: dict[str, list[Key]] = {}
    for oid, raws in spellings.items():
        if oid in apart:
            continue
        keys: list[Key] = []
        for raw in raws:
            text = matching.first_language(raw)
            if text not in cache:
                cache[text] = _PERSON if matching.is_person_name(text) else match_key(text)
            key = cache[text]
            if key is _PERSON:
                keys = []
                break
            if key is not None:
                keys.append(key)
        if keys:
            out[oid] = keys
    return out


def _by_spelling(forest: _Forest, keys: dict[str, list[Key]], rank: dict[str, tuple], earlier: set[str],
                 *, join: bool) -> list[SpellingGroup]:
    """The spelling rule: the organizations whose spellings share a match key, each group's survivor first; joined only
    when join is set (config.ORG_SPELLING_MERGE "on")."""
    roots_of: dict[str, set[str]] = defaultdict(set)
    by_root_keys: dict[str, list[Key]] = defaultdict(list)
    for oid, ks in keys.items():
        r = forest.root(oid)
        by_root_keys[r].extend(ks)
        for k in ks:
            roots_of[k.key].add(r)
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    # An organization whose spellings give two keys joins the groups of both.
    shared_keys = {k: roots for k, roots in roots_of.items() if len(roots) > 1}
    for roots in shared_keys.values():
        first, *rest = sorted(roots)
        for r in rest:
            a, b = find(first), find(r)
            if a != b:
                parent[max(a, b)] = min(a, b)
    members: dict[str, set[str]] = defaultdict(set)
    shared_by: dict[str, list[str]] = defaultdict(list)
    for k, roots in shared_keys.items():
        head = find(next(iter(roots)))
        members[head] |= roots
        shared_by[head].append(k)
    groups: list[SpellingGroup] = []
    for head in sorted(members):
        group = members[head]
        shared = sorted(shared_by[head])
        made = [k for r in group for k in by_root_keys[r] if k.key in shared]
        union = frozenset().union(*(k.steps for k in made))
        steps = set(union - frozenset.intersection(*(k.steps for k in made))) or set(union)
        if any(len({k.words for k in made if k.key == s}) > 1 for s in shared):
            steps.add("spacing")
        pool = [m for m in group if m in earlier] or list(group)
        survivor = min(pool, key=rank.__getitem__)
        ordered = [survivor] + sorted((m for m in group if m != survivor), key=rank.__getitem__)
        key = shared[0] if len(shared) == 1 else " | ".join(shared)
        groups.append(SpellingGroup(key, tuple(sorted(steps)), ordered))
        if join:
            for m in ordered[1:]:
                forest.join(m, survivor, "spelling", f"{key} ({', '.join(sorted(steps)) or 'same key'})")
    return groups


def _candidates(conn: sqlite3.Connection, forest: _Forest, keys: dict[str, list[Key]],
                spellings: dict[str, set[str]], rank: dict[str, tuple], groups: list[SpellingGroup],
                seed: list[SeedRow], apart: set[str]) -> list[Candidate]:
    """The pairs no rule may merge, for the operator to accept into the seed or keep apart."""
    root = forest.root
    in_group = {m: i for i, g in enumerate(groups) for m in g.members}
    seeded = {frozenset((org_id(r.from_norm), org_id(r.to_norm))) for r in seed}
    seen: set[frozenset[str]] = set()
    out: list[Candidate] = []

    def add(kind: str, a: str, b: str, detail: str, *, by_rank: bool) -> None:
        a, b = root(a), root(b)
        pair = frozenset((a, b))
        if a == b or a in apart or b in apart or pair in seen or pair in seeded:
            return
        if a in in_group and in_group[a] == in_group.get(b):
            return  # listed with its spelling group already
        if by_rank and rank[a] < rank[b]:
            a, b = b, a  # the one with fewer records joins the other
        seen.add(pair)
        out.append(Candidate(kind, a, b, detail))

    roots_of: dict[str, set[str]] = defaultdict(set)
    words_of: dict[str, tuple[str, ...]] = {}
    for oid, ks in keys.items():
        for k in ks:
            roots_of[k.key].add(root(oid))
            words_of.setdefault(k.key, k.words)

    # Operating names: "1019837 ONTARIO INC O/A DYNAMIC PERSONNEL CONSULTANTS" beside "DYNAMIC PERSONNEL
    # CONSULTANTS". Usually one business, but a trade name is not unique across provinces.
    for oid in sorted(keys):
        for raw in sorted(spellings.get(oid, ())):
            operating = split_trade_name(matching.first_language(raw))[1]
            if not operating or matching.is_person_name(operating):
                continue
            k = match_key(operating)
            for other in sorted(roots_of.get(k.key, ())) if k else ():
                add("operating", oid, other, f"operates as {operating}", by_rank=True)

    # Likely renames or assignments: one contract whose amendments name two organizations, the earlier first.
    pairs: Counter[tuple[str, str]] = Counter()
    example: dict[tuple[str, str], str] = {}
    for table in ("awards", "contract_history"):
        last_ref, last_root = None, None
        for ref, oid in conn.execute(f"SELECT reference, organization_id FROM {table} "
                                     "WHERE organization_id IS NOT NULL ORDER BY reference, amendment"):
            r = root(oid)
            if ref == last_ref and r != last_root and last_root is not None:
                pairs[(last_root, r)] += 1
                example.setdefault((last_root, r), ref)
            last_ref, last_root = ref, r
    for (a, b), n in sorted(pairs.items()):
        add("former", a, b, f"{n} contracts amended from one to the other, e.g. {example[(a, b)]}", by_rank=False)

    # Names ending in a place word ("Cofomo Ottawa" beside "Cofomo Inc."), each to the one without it.
    stripped: dict[str, set[str]] = defaultdict(set)
    for key, words in words_of.items():
        base = strip_places(words)
        if base != words and any(distinctive(w) for w in base):
            stripped["".join(base)] |= roots_of[key]
    for base, branches in sorted(stripped.items()):
        plain = roots_of.get(base, set())
        everyone = branches | plain
        if not 2 <= len(everyone) <= PLACE_MAX:
            continue  # a family of separate bodies (a university's campuses, the Commissionaires divisions)
        target = min(plain or everyone, key=rank.__getitem__)
        for r in sorted(everyone - {target}):
            add("place", r, target, f"the same name without its place words ({base})", by_rank=False)

    # Short forms: "Simex" beside "Simex Defence Inc.", when it starts at most SHORT_MAX longer names.
    entries = sorted((" ".join(words) + " ", key) for key, words in words_of.items())
    starts = [e[0] for e in entries]
    for key, words in sorted(words_of.items()):
        prefix = " ".join(words) + " "
        i = bisect.bisect_left(starts, prefix)
        longer: list[str] = []
        while i < len(entries) and starts[i].startswith(prefix) and len(longer) <= SHORT_MAX:
            if entries[i][1] != key:
                longer.append(entries[i][1])
            i += 1
        if 1 <= len(longer) <= SHORT_MAX:
            for other in longer:
                for a in sorted(roots_of[key]):
                    for b in sorted(roots_of[other]):
                        add("short", a, b, f"a short form of {len(longer)} longer name(s)", by_rank=False)

    # Typos: keys one or two edits apart (a transposition counts one) in long words.
    for ka, kb, d in _typo_pairs(sorted(k for k in words_of if len(k) >= TYPO_MIN_KEY
                                        and not re.search(r"\d{5}", k)), words_of):
        for a in sorted(roots_of[ka]):
            for b in sorted(roots_of[kb]):
                add("typo", a, b, f"{d} edit(s)", by_rank=True)
    return out


def _typo_pairs(pool: list[str], words_of: dict[str, tuple[str, ...]]) -> list[tuple[str, str, int]]:
    """Keys of pool one or two edits apart, every differing word TYPO_MIN_WORD long on both sides.

    Two keys within two edits share a string with one character deleted from
    each (or from neither, or from one), so only keys whose deletions hash
    alike are compared, never every pair. The hashes sit in two flat arrays
    (about 12 bytes a deletion: some 80 MB for 300,000 keys) and are sorted in
    TYPO_PASSES slices, so no dictionary of millions of strings is built. A
    numbered company ("1234567 ontario") is left out by the caller: one digit
    apart is another company.
    """
    hashes, owners = array("q"), array("i")
    for i, k in enumerate(pool):
        for v in {k, *(k[:j] + k[j + 1:] for j in range(len(k)))}:
            hashes.append(hash(v))
            owners.append(i)
    width = max(len(pool), 1).bit_length()
    mask = (1 << width) - 1
    close: set[tuple[int, int]] = set()
    for part in range(TYPO_PASSES):
        entries = sorted(((h // TYPO_PASSES) << width) | o for h, o in zip(hashes, owners) if h % TYPO_PASSES == part)
        start = 0
        for x in range(1, len(entries) + 1):
            if x == len(entries) or entries[x] >> width != entries[start] >> width:
                ids = sorted({entries[y] & mask for y in range(start, x)})
                # A deletion shared by dozens of keys says nothing about any two of them.
                if 1 < len(ids) <= 50:
                    close.update((a, b) for n, a in enumerate(ids) for b in ids[n + 1:])
                start = x
    out: list[tuple[str, str, int]] = []
    for a, b in sorted(close):
        ka, kb = pool[a], pool[b]
        d = edit_distance(ka, kb)
        if not d:
            continue
        wa, wb = words_of[ka], words_of[kb]
        only_a, only_b = [w for w in wa if w not in wb], [w for w in wb if w not in wa]
        if only_a and only_b and all(len(w) >= TYPO_MIN_WORD for w in only_a + only_b):
            out.append((ka, kb, d))
    return out


def _mark_places(conn: sqlite3.Connection, groups: list[SpellingGroup], candidates: list[Candidate]) -> None:
    """Fill in what the members of each group, and the two sides of each candidate, have in common, and the
    groups' provinces (organization_places)."""
    ids = sorted({m for g in groups for m in g.members} | {c.from_id for c in candidates}
                 | {c.to_id for c in candidates})
    if not ids:
        return
    places = _places(conn, ids)
    provinces: dict[str, set[str]] = defaultdict(set)
    for oid, province in conn.execute("SELECT organization_id, province FROM organization_places "
                                      "WHERE organization_id IN (SELECT id FROM temp.merge_ids) AND province != ''"):
        provinces[oid].add(province)

    def common(members: list[str]) -> str:
        counts = Counter(p for m in members for p in places.get(m, set()))
        return ", ".join(sorted({p.split(":", 1)[0] for p, n in counts.items() if n > 1}))

    for g in groups:
        g.place = common(g.members)
        g.provinces = {m: sorted(provinces.get(m, ())) for m in g.members}
    for c in candidates:
        c.place = common([c.from_id, c.to_id])


def apply(conn: sqlite3.Connection, *, now: str | None = None, seed_path: Path | None = None,
          spelling: str | None = None) -> Outcome:
    """Restore, clear, decide the night's merges and move the records; the caller commits (organizations.run).

    spelling is the spelling rule's mode (SPELLING_MODES), config.ORG_SPELLING_MERGE when not given.
    """
    stamp = now or now_iso()
    mode = spelling or config.ORG_SPELLING_MERGE
    if mode not in SPELLING_MODES:
        raise ValueError(f"ORG_SPELLING_MERGE is {mode!r}, not one of {', '.join(SPELLING_MODES)}")
    outcome = Outcome(spelling_mode=mode)
    previous = _previous(conn)
    try:
        outcome.restored = _restore(conn, stamp)
        outcome.cleared = _clear_not_organizations(conn)
        records = _record_counts(conn)
        live = set(records)
        norms = {oid: n for oid, n in conn.execute("SELECT id, norm_name FROM organizations") if oid in live}
        names = {oid: n for oid, n in conn.execute("SELECT id, display_name FROM organizations") if oid in live}
        seed, apart_names, outcome.unapplied = read_seed(seed_path)
        apart = {org_id(n) for n in apart_names}
        rank = {oid: (-records[oid], -len(norms.get(oid, "")), oid) for oid in live}
        earlier = {new for new, _ in previous.values()}

        forest = _Forest()
        numbers = organizations._business_numbers(conn)
        shared = Counter(bn for oid, bn in numbers.items() if oid in live)
        places = _places(conn, sorted(oid for oid, bn in numbers.items() if shared[bn] > 1 and oid in live))
        outcome.review = _by_business_number(forest, numbers, live, apart, rank, earlier, norms, places, names, records)
        outcome.review += _by_truncation(forest, _cut_names(conn, live), norms, live, apart, previous, names, records)
        spellings = _spellings(conn, live)
        keys = _keys(spellings, apart)
        groups = _by_spelling(forest, keys, rank, earlier, join=mode == "on") if mode != "off" else []
        for row in seed:
            a, b = org_id(row.from_norm), org_id(row.to_norm)
            if a not in live or b not in live:
                outcome.unapplied.append(f"{row.from_norm}\t{row.to_norm}\t{'from_norm' if a not in live else 'to_norm'} "
                                         "names no organization with records")
                continue
            forest.join(a, b, "seed", row.reason)
        # In shadow, a group the seed has joined since is no longer news.
        outcome.spelling = [g for g in groups if mode == "on" or len({forest.root(m) for m in g.members}) > 1]
        outcome.candidates = _candidates(conn, forest, keys, spellings, rank, outcome.spelling, seed, apart)
        _mark_places(conn, outcome.spelling, outcome.candidates)

        final = {oid: forest.root(oid) for oid in forest.parent}
        outcome.merges = [Merge(oid, final[oid], *forest.link[oid]) for oid in sorted(final)]
        shown = {*final, *final.values(), *(m for g in outcome.spelling for m in g.members),
                 *(c.from_id for c in outcome.candidates), *(c.to_id for c in outcome.candidates)}
        outcome.names = {oid: names.get(oid, "") for oid in shown}
        outcome.norms = {oid: norms.get(oid, "") for oid in shown}
        outcome.records = {oid: records.get(oid, 0) for oid in shown}
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
    if not (outcome.merges or outcome.review or outcome.unapplied or outcome.spelling or outcome.candidates):
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
    lines += _spelling_lines(outcome)
    lines += _candidate_lines(outcome)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        shown = path.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        shown = str(path)
    joining = sum(len(g.members) - 1 for g in outcome.spelling)
    return (f"{len(outcome.merges)} organizations merged into others "
            f"({', '.join(f'{r} {by.get(r, 0)}' for r in REASONS)}), {len(outcome.review)} left for review, "
            f"{len(outcome.unapplied)} seed rows not applied, spelling rule {outcome.spelling_mode}: "
            f"{len(outcome.spelling)} groups ({joining} organizations to join another), "
            f"{len(outcome.candidates)} candidates for the seed; listed in {shown}")


def _spelling_lines(outcome: Outcome) -> list[str]:
    """The spelling rule's groups, those whose members' provinces never overlap first: one line per organization."""
    if not outcome.spelling:
        return []
    joining = sum(len(g.members) - 1 for g in outcome.spelling)
    state = ("merged (each merge is also listed above)" if outcome.spelling_mode == "on" else
             "shadow, nothing merged until config.ORG_SPELLING_MERGE is \"on\"")
    lines = [
        f"# Spelling rule ({state}): {len(outcome.spelling)} groups sharing a match key, "
        f"{joining} organizations to join the first of their group.",
        "# place: a city or postal code two members have in common (blank: none). provinces_overlap: no lists a",
        "# group whose members were never seen in one province, the ones to read first. A wrong group is kept",
        "# apart by a seed row with the member's normalized name as from_norm and an empty to_norm.",
        "# key\tsteps\tplace\tprovinces_overlap\trole\tid\tname\trecords\tprovinces",
    ]
    order = {"no": 0, "unknown": 1, "yes": 2}
    for g in sorted(outcome.spelling, key=lambda g: (order[g.overlap], bool(g.place), g.key)):
        for i, m in enumerate(g.members):
            lines.append("\t".join((g.key, ", ".join(g.steps), g.place, g.overlap, "survivor" if i == 0 else "joins",
                                    m, outcome.names.get(m, ""), str(outcome.records.get(m, 0)),
                                    ",".join(g.provinces.get(m, [])))))
    return lines


def _candidate_lines(outcome: Outcome) -> list[str]:
    """The candidates for the seed, by kind; at most CANDIDATE_LIMIT of each, a place in common first."""
    if not outcome.candidates:
        return []
    by = Counter(c.kind for c in outcome.candidates)
    lines = [
        f"# Candidates for the seed, which no rule merges: {len(outcome.candidates)} pairs "
        f"({', '.join(f'{k} {by.get(k, 0)}' for k in CANDIDATE_KINDS)}); at most {CANDIDATE_LIMIT} of each kind "
        "listed, a place in common first.",
        "# A pair that is one organization: copy its seed_row into awardwatch_pipeline/data/organization_aliases.csv",
        "# and write the reason in (from_norm,to_norm,reason,note). A pair to keep apart: a row with from_norm and an",
        "# empty to_norm. operating: an operating name that is another organization's name; former: one contract's",
        "# amendments name both (a rename or an assignment); place: the same name without its place words; short: a",
        "# short form; typo: one or two edits apart.",
        "# kind\tplace\tfrom_id\tfrom_name\tfrom_records\tto_id\tto_name\tto_records\tdetail\tseed_row",
    ]
    kinds = list(CANDIDATE_KINDS)
    ranked = sorted(outcome.candidates, key=lambda c: (
        kinds.index(c.kind), not c.place, -max(outcome.records.get(c.from_id, 0), outcome.records.get(c.to_id, 0)),
        c.from_id, c.to_id))
    listed: Counter[str] = Counter()
    for c in ranked:
        listed[c.kind] += 1
        if listed[c.kind] > CANDIDATE_LIMIT:
            continue
        row = f"{outcome.norms.get(c.from_id, '')},{outcome.norms.get(c.to_id, '')},,{CANDIDATE_KINDS[c.kind]}"
        lines.append("\t".join((c.kind, c.place, c.from_id, outcome.names.get(c.from_id, ""),
                                str(outcome.records.get(c.from_id, 0)), c.to_id, outcome.names.get(c.to_id, ""),
                                str(outcome.records.get(c.to_id, 0)), c.detail, row)))
    return lines
