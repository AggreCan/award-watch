"""Values to check: a contract's value that another record contradicts, flagged every night.

Some published values are not what a contract is worth: an award notice of
$3,674,807,000 whose published contract says $3,674,808, a hotel in Dakar at
$776,580,000 with no currency where PSPC's history of the same contract says
$3,727,584, a total value two thousand times the amount. This check runs in
the organizations stage (organizations.run), after the merges and before the
totals are computed, and rebuilds value_flags whole. A contract is flagged when:

* other_source: another source carries the same contract number for the same
  organization with a value more than RATIO_SOURCES times smaller, and then
  the larger value is the one flagged (the error seen is digits added, not
  lost). The numbers compared are an award notice's contract number, a
  history record's contract and procurement numbers, and a published
  contract's procurement_id, as expiring.contract_number writes them (upper
  case, letters and digits); two numbers of digits only also match when the
  longer ends with the shorter and the shorter has SUFFIX_DIGITS digits or more
  ("7063142" on the award notice, "5007063142" on the published contract);
* total_vs_amount: an award notice or history contract whose total value on
  its newest version is more than RATIO_TOTAL times the largest amount any of
  its versions carries, when that amount is AMOUNT_FLOOR or more: an amount
  of a few cents is itself the error ($0.02 beside a total of $1,237,175,249.02
  on W8485-02KK80/001/SSC), and the total is then the figure to keep;
* currency_abroad: an award notice or history contract with a value and no
  currency whose supplier's address (the record's own country, else its
  organization's) is outside Canada; a blank currency is read as CAD by every
  total, which only holds at home.

The values compared are the counted ones: the newest version's total value
when positive, else its amount (a cancelled contract is not checked), and for
a published contract the largest value reported under its department and
procurement_id. A flagged value stays on its record and is exported with
value_flag "check"; the counting rules (organizations.award_value,
organizations.CONTRACT_CHECKED) leave it out of every total, ranking and top
list. Each flag is listed in data/out/review/value-flags.txt for the operator.

CanadaBuys writes 0.00 in both the amount and the total of a notice that
publishes no value (most standing offers and supply arrangements; the notice
page shows no value at all). clear_unpublished stores those as NULL, every
night and for every version already loaded, so no figure reads them as $0;
a zero beside a positive figure is the source's own and stays.
"""

from __future__ import annotations

import logging
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from . import config, organizations
from .db import now_iso
from .expiring import contract_number

log = logging.getLogger(__name__)

RATIO_SOURCES = 10
RATIO_TOTAL = 100
AMOUNT_FLOOR = 1000.0
SUFFIX_DIGITS = 7
REVIEW_FILE = "value-flags.txt"
RULES = ("other_source", "total_vs_amount", "currency_abroad")
KINDS = ("award", "history", "contract")
NOTICE_TABLES = {"award": "awards", "history": "contract_history"}


@dataclass
class Flag:
    kind: str
    key: str
    org: str | None
    value: float
    rules: list[str] = field(default_factory=list)
    details: list[str] = field(default_factory=list)
    name: str = ""

    def add(self, rule: str, detail: str) -> None:
        if rule not in self.rules:
            self.rules.append(rule)
        self.details.append(detail)


@dataclass(frozen=True)
class _Entry:
    kind: str
    key: str
    org: str | None
    numbers: tuple[str, ...]
    value: float


def clear_unpublished(conn: sqlite3.Connection) -> int:
    """Store NULL, not 0, where a CanadaBuys version's amount and total are both zero or blank."""
    changed = 0
    for table in NOTICE_TABLES.values():
        changed += conn.execute(
            f"UPDATE {table} SET amount = NULL, total_value = NULL WHERE COALESCE(amount, 0) = 0 "
            "AND COALESCE(total_value, 0) = 0 AND (amount IS NOT NULL OR total_value IS NOT NULL)").rowcount
    return changed


def _notices(conn: sqlite3.Connection, kind: str, countries: dict[str, str | None]) -> list[tuple[_Entry, dict]]:
    table = NOTICE_TABLES[kind]
    numbers = "n.contract_number, n.procurement_number" if kind == "history" else "n.contract_number, NULL"
    sql = (
        f"WITH newest AS ({organizations._newest_by_reference(table, ('reference',))}) "
        f"SELECT n.reference, n.org, n.amount, n.total_value, n.currency, n.supplier_country, n.status, {numbers}, "
        f"(SELECT MAX(z.amount) FROM {table} z WHERE z.reference = n.reference) AS top_amount "
        "FROM newest n ORDER BY n.reference"
    )
    out = []
    for r in conn.execute(sql):
        if r[6] == "cancelled":
            continue
        total, amount = r[3], r[2]
        value = total if total is not None and total > 0 else amount
        if value is None or value <= 0:
            continue
        nums = tuple(dict.fromkeys(n for n in (contract_number(r[7]), contract_number(r[8])) if n))
        country = (r[5] or countries.get(r[1]) or "").strip().upper()
        out.append((_Entry(kind, r[0], r[1], nums, float(value)),
                    {"total": total, "top_amount": r[9], "currency": (r[4] or "").strip(), "country": country}))
    return out


def _contract_groups(conn: sqlite3.Connection) -> list[_Entry]:
    out = []
    for owner, pid, org, top in conn.execute(
            "SELECT owner_org, procurement_id, organization_id, MAX(value) FROM contracts "
            "WHERE procurement_id IS NOT NULL AND TRIM(procurement_id) != '' AND organization_id IS NOT NULL "
            "GROUP BY owner_org, procurement_id, organization_id ORDER BY owner_org, procurement_id, organization_id"):
        number = contract_number(pid)
        if number and top is not None and top > 0:
            out.append(_Entry("contract", f"{owner}:{pid}", org, (number,), float(top)))
    return out


def _same_number(a: str, b: str) -> bool:
    if a == b:
        return True
    if a.isdigit() and b.isdigit():
        short, long_ = sorted((a, b), key=len)
        return len(short) >= SUFFIX_DIGITS and long_.endswith(short)
    return False


def _other_source(entries: list[_Entry], flags: dict[tuple[str, str], Flag]) -> None:
    by_number: dict[tuple[str, str], list[_Entry]] = defaultdict(list)
    by_tail: dict[tuple[str, str], list[_Entry]] = defaultdict(list)
    for e in entries:
        if not e.org:
            continue
        for n in e.numbers:
            by_number[(e.org, n)].append(e)
            if n.isdigit() and len(n) >= SUFFIX_DIGITS:
                by_tail[(e.org, n[-SUFFIX_DIGITS:])].append(e)
    for e in entries:
        if not e.org:
            continue
        seen: dict[tuple[str, str], _Entry] = {}
        for n in e.numbers:
            pool = by_number[(e.org, n)] + (by_tail[(e.org, n[-SUFFIX_DIGITS:])] if n.isdigit() else [])
            for f in pool:
                if f.kind != e.kind and any(_same_number(n, m) for m in f.numbers):
                    seen[(f.kind, f.key)] = f
        smaller = [f for _, f in sorted(seen.items()) if e.value > RATIO_SOURCES * f.value]
        if smaller:
            f = smaller[0]
            flags.setdefault((e.kind, e.key), Flag(e.kind, e.key, e.org, e.value)).add(
                "other_source", f"{e.value:,.2f} against {f.kind} {f.key} {f.value:,.2f}")


def compute(conn: sqlite3.Connection, *, now: str | None = None) -> list[Flag]:
    """Rebuild value_flags; returns the flags. The caller commits (organizations.run)."""
    stamp = now or now_iso()
    clear_unpublished(conn)
    countries = dict(conn.execute("SELECT id, country FROM organizations"))
    flags: dict[tuple[str, str], Flag] = {}
    entries: list[_Entry] = []
    for kind in ("award", "history"):
        for e, extra in _notices(conn, kind, countries):
            entries.append(e)
            total, top = extra["total"], extra["top_amount"]
            if total is not None and top is not None and top >= AMOUNT_FLOOR and total > RATIO_TOTAL * top:
                flags.setdefault((e.kind, e.key), Flag(e.kind, e.key, e.org, e.value)).add(
                    "total_vs_amount", f"total {total:,.2f} against a largest amount of {top:,.2f}")
            if not extra["currency"] and extra["country"] and extra["country"] != "CA":
                flags.setdefault((e.kind, e.key), Flag(e.kind, e.key, e.org, e.value)).add(
                    "currency_abroad", f"{e.value:,.2f} with no currency, supplier in {extra['country']}")
    entries += _contract_groups(conn)
    _other_source(entries, flags)
    ordered = [flags[k] for k in sorted(flags, key=lambda k: (KINDS.index(k[0]), k[1]))]
    names = dict(conn.execute("SELECT id, display_name FROM organizations"))
    for f in ordered:
        f.name = names.get(f.org, "") if f.org else ""
    conn.execute("DELETE FROM value_flags")
    conn.executemany(
        "INSERT INTO value_flags (kind, key, rule, detail, computed_at) VALUES (?, ?, ?, ?, ?)",
        [(f.kind, f.key, ",".join(r for r in RULES if r in f.rules), "; ".join(f.details)[:900], stamp)
         for f in ordered])
    return ordered


def flagged(conn: sqlite3.Connection) -> dict[str, set[str]]:
    """The keys value_flags lists, by kind (the export's lookup)."""
    out: dict[str, set[str]] = {k: set() for k in KINDS}
    for kind, key in conn.execute("SELECT kind, key FROM value_flags"):
        out.setdefault(kind, set()).add(key)
    return out


def write_review(flags: list[Flag], path: Path, *, stamp: str) -> str | None:
    """Write (or, with nothing flagged, remove) the operator's list of flagged values; returns the log's notice."""
    if not flags:
        path.unlink(missing_ok=True)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"# Values to check, run of {stamp}: {len(flags)} contracts. Each value stays on its record, is",
             "# exported with value_flag \"check\" and is left out of every total. For the operator: no step",
             "# publishes this file.",
             "# kind\tkey\torganization_id\torganization\tvalue\trules\tdetail"]
    for f in flags:
        lines.append("\t".join((f.kind, f.key, f.org or "", f.name, f"{f.value:.2f}",
                                ",".join(r for r in RULES if r in f.rules), "; ".join(f.details))))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        shown = path.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        shown = str(path)
    return f"{len(flags)} contract values flagged for checking and left out of the totals; listed in {shown}"
