"""Contracts ending soon: the expiring-contracts radar, rebuilt whole after the indicators stage.

CLAUDE.md "Expiring-contracts radar" is the rule; this module follows it:

* A candidate is an award notice, a PSPC contract history record or a
  published contract whose newest version ends on or after the data date and
  within HORIZON_DAYS of it, and is not cancelled. The end date, the value and
  every other field come from the newest version (amendments move them). A
  published contract's versions are the rows sharing its department and
  procurement_id (a row with none stands alone); its end date is the newest
  row's delivery_date, its value the sum of the rows' own values (the counting
  rules), its original amount the first row's original_value.
* The same contract can appear in all three sources, and the radar lists it
  once. Award notices are kept first, then history records, then published
  contracts. A row from a later source is dropped when its contract number
  equals one a kept row from an earlier source carries, or when its
  organization, buyer, end date (within END_DAYS) and value (within
  VALUE_SHARE) all match such a row. Rows of one source are never dropped
  against each other. A history record's buyer is its client department and
  PSPC both (an award notice names PSPC where history names the client), and a
  published contract's contract numbers are its procurement_id and its
  reference number.
* value is the counted value in the row's own currency; value_growth is that
  value over the original amount, minus 1, NULL when either is unknown or the
  original is zero. The original amount is the original version's value by
  the same rule (its total value when positive, else its amount): a notice's
  total value often includes options its first amount does not, and setting
  the newest total against the first amount alone would show growth on a
  contract nobody amended. n_amendments counts the versions beyond
  the original; tender_reference is the reference of the tender notice whose
  solicitation number matches the row's (resolved through tenders), never the
  solicitation number itself.
* A withheld supplier stays withheld: no organization, supplier_withheld 1.
* entered_3m is the data date on which a row first came within FEED_DAYS of
  its end, carried over from the previous build while the row stays in that
  window, so the feed lists each contract once, on the night it entered.

Windows and totals are the export's (export_static.write_expiring): the rows
are stored with their end date, and days_left is counted again from the
export's data date.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from . import organizations
from .db import log_run, now_iso

log = logging.getLogger(__name__)

HORIZON_DAYS = 365
FEED_DAYS = 91
# The windows the site shows, cumulative, in days from the data date.
WINDOWS = (("3m", 91), ("6m", 182), ("12m", 365))
END_DAYS = 3
VALUE_SHARE = 0.01
# A contract number this short ("1", "001") is a placeholder, not an identity.
NUMBER_MIN = 5
KINDS = ("award", "history", "contract")

# The published contracts' instrument codes (TBS guide), with both labels.
INSTRUMENTS = {
    "C": ("Contract", "Contrat"),
    "SO": ("Standing offer", "Offre à commandes"),
    "SA": ("Supply arrangement", "Arrangement en matière d’approvisionnement"),
    "SOSA": ("Standing offer or supply arrangement", "Offre à commandes ou arrangement en matière d’approvisionnement"),
}

COLUMNS = ("source_key", "kind", "reference", "title_en", "title_fr", "organization_id", "organization",
           "supplier_withheld", "buyer_id", "buyer_en", "buyer_fr", "start", "end", "days_left", "value", "currency",
           "competitive", "method_en", "method_fr", "instrument_en", "instrument_fr", "n_amendments", "value_growth",
           "contract_number", "tender_reference", "segments", "provinces", "entered_3m", "computed_at")


@dataclass
class Candidate:
    kind: str
    source_key: str
    reference: str
    end: date
    row: dict
    org: str | None
    buyers: frozenset[str]
    numbers: tuple[str, ...]
    value: float | None


def contract_number(raw: object) -> str | None:
    """A contract number as the duplicate rule compares it: upper case, letters and digits only."""
    text = re.sub(r"[^A-Z0-9]", "", str(raw or "").upper())
    return text if len(text) >= NUMBER_MIN else None


def growth(newest: float | None, original: float | None) -> float | None:
    if newest is None or original is None or original == 0:
        return None
    return round(newest / original - 1, 4)


def _day(text: object) -> date | None:
    try:
        return date.fromisoformat(str(text or "")[:10])
    except ValueError:
        return None


def _segments(codes: object) -> list[str]:
    return sorted({c[:2] for c in str(codes or "").split() if len(c) >= 2 and c[:2].isdigit()})


def _sol(value: object) -> str | None:
    text = str(value or "").strip().upper()
    return text or None


class _Names:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.buyers = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT id, name_en, name_fr FROM buyers")}
        self.orgs = dict(conn.execute("SELECT id, display_name FROM organizations"))
        self.tenders: dict[str, str] = {}
        for ref, sol in conn.execute("SELECT reference, solicitation FROM tenders WHERE solicitation IS NOT NULL "
                                     "ORDER BY reference"):
            key = _sol(sol)
            if key and key not in self.tenders:
                self.tenders[key] = ref

    def buyer(self, buyer_id: str | None, raw_en: object = None, raw_fr: object = None) -> tuple[str | None, str | None]:
        if buyer_id in self.buyers:
            return self.buyers[buyer_id]
        en = str(raw_en).strip() if raw_en else None
        fr = str(raw_fr).strip() if raw_fr else None
        return en or None, fr or None


def notice_candidates(conn: sqlite3.Connection, kind: str, names: _Names, first: str, last: str,
                      today: date) -> list[Candidate]:
    """Award notices (kind 'award') or contract history records ('history') ending between first and last."""
    table, codes = ("awards", "award_codes") if kind == "award" else ("contract_history", "history_codes")
    client = ("n.client_id, n.client_raw_en, n.client_raw_fr, n.procurement_number" if kind == "history"
              else "NULL AS client_id, NULL AS client_raw_en, NULL AS client_raw_fr, NULL AS procurement_number")
    sql = (
        f"WITH newest AS ({organizations._newest_by_reference(table, ('reference',))}) "
        "SELECT n.reference, n.title_en, n.title_fr, n.org, n.supplier_withheld, n.buyer_id, n.buyer_raw_en, "
        f"n.buyer_raw_fr, {client}, n.start, substr(n.\"end\", 1, 10) AS end_day, n.amount, n.total_value, "
        "n.currency, n.competitive, n.method_en, n.method_fr, n.instrument_type_en, n.instrument_type_fr, "
        "n.contract_number, n.solicitation, n.provinces, "
        f"(SELECT COUNT(*) FROM {table} z WHERE z.reference = n.reference) AS versions, "
        f"(SELECT CASE WHEN z.total_value > 0 THEN z.total_value ELSE z.amount END FROM {table} z "
        "WHERE z.reference = n.reference ORDER BY z.amendment LIMIT 1) AS original, "
        f"(SELECT group_concat(c.unspsc, ' ') FROM {codes} c WHERE c.reference = n.reference "
        "AND c.amendment = n.amendment) AS codes "
        "FROM newest n WHERE substr(n.\"end\", 1, 10) BETWEEN ? AND ? AND COALESCE(n.status, '') != 'cancelled' "
        "ORDER BY end_day, n.reference"
    )
    out: list[Candidate] = []
    for r in conn.execute(sql, (first, last)):
        end = _day(r["end_day"])
        if end is None:
            continue
        withheld = bool(r["supplier_withheld"])
        org = None if withheld else r["org"]
        value = r["total_value"] if r["total_value"] is not None and r["total_value"] > 0 else r["amount"]
        if kind == "history" and (r["client_id"] or r["client_raw_en"]):
            buyer = r["client_id"]
            b_en, b_fr = names.buyer(buyer, r["client_raw_en"], r["client_raw_fr"])
        else:
            buyer = r["buyer_id"]
            b_en, b_fr = names.buyer(buyer, r["buyer_raw_en"], r["buyer_raw_fr"])
        numbers = tuple(n for n in (contract_number(r["contract_number"]), contract_number(r["procurement_number"])) if n)
        row = {
            "kind": kind, "reference": r["reference"], "title_en": r["title_en"], "title_fr": r["title_fr"],
            "organization_id": org, "organization": names.orgs.get(org) if org else None,
            "supplier_withheld": 1 if withheld else 0, "buyer_id": buyer, "buyer_en": b_en, "buyer_fr": b_fr,
            "start": r["start"], "end": end.isoformat(), "days_left": (end - today).days, "value": value,
            "currency": (r["currency"] or "").strip().upper() or None, "competitive": r["competitive"],
            "method_en": r["method_en"], "method_fr": r["method_fr"], "instrument_en": r["instrument_type_en"],
            "instrument_fr": r["instrument_type_fr"], "n_amendments": max((r["versions"] or 1) - 1, 0),
            "value_growth": growth(value, r["original"]), "contract_number": numbers[0] if numbers else None,
            "tender_reference": names.tenders.get(_sol(r["solicitation"]) or ""),
            "segments": json.dumps(_segments(r["codes"])),
            "provinces": json.dumps(json.loads(r["provinces"]) if r["provinces"] else []),
        }
        buyers = frozenset(b for b in (r["buyer_id"], r["client_id"]) if b)
        out.append(Candidate(kind, f"{kind}:{r['reference']}", r["reference"], end, row, org, buyers, numbers, value))
    return out


def contract_candidates(conn: sqlite3.Connection, names: _Names, first: str, last: str, today: date) -> list[Candidate]:
    """Published contracts ending between first and last, one per department and procurement_id."""
    from .indicators import CONTRACT_VALUE

    sql = (
        "WITH g AS (SELECT c.*, CASE WHEN c.procurement_id IS NOT NULL AND TRIM(c.procurement_id) != '' "
        "THEN 'p:' || c.procurement_id ELSE 'r:' || c.reference END AS gk, "
        f"{CONTRACT_VALUE} AS own FROM contracts c), "
        "r AS (SELECT g.*, "
        "ROW_NUMBER() OVER (PARTITION BY owner_org, gk ORDER BY contract_date DESC, reference DESC) AS rn, "
        "COUNT(*) OVER (PARTITION BY owner_org, gk) AS versions, "
        "SUM(own) OVER (PARTITION BY owner_org, gk) AS group_value, "
        "FIRST_VALUE(COALESCE(original_value, value)) OVER (PARTITION BY owner_org, gk "
        "ORDER BY contract_date, reference) AS original, "
        "MIN(CASE WHEN instrument_type != 'A' THEN instrument_type END) OVER (PARTITION BY owner_org, gk) AS instrument "
        "FROM g) "
        "SELECT owner_org, reference, procurement_id, vendor_withheld, organization_id, buyer_id, period_start, "
        "substr(delivery_date, 1, 10) AS end_day, competitive, description_en, description_fr, versions, group_value, "
        "original, instrument FROM r WHERE rn = 1 AND substr(delivery_date, 1, 10) BETWEEN ? AND ? "
        "ORDER BY end_day, owner_org, reference"
    )
    out: list[Candidate] = []
    for r in conn.execute(sql, (first, last)):
        end = _day(r["end_day"])
        if end is None:
            continue
        withheld = bool(r["vendor_withheld"])
        org = None if withheld else r["organization_id"]
        b_en, b_fr = names.buyer(r["buyer_id"])
        reference = f"{r['owner_org']}:{r['reference']}"
        instrument = INSTRUMENTS.get(str(r["instrument"] or "").upper(), (None, None))
        numbers = tuple(dict.fromkeys(n for n in (contract_number(r["procurement_id"]), contract_number(r["reference"])) if n))
        value = r["group_value"]
        row = {
            "kind": "contract", "reference": reference, "title_en": r["description_en"],
            "title_fr": r["description_fr"], "organization_id": org,
            "organization": names.orgs.get(org) if org else None, "supplier_withheld": 1 if withheld else 0,
            "buyer_id": r["buyer_id"], "buyer_en": b_en, "buyer_fr": b_fr, "start": r["period_start"],
            "end": end.isoformat(), "days_left": (end - today).days, "value": value, "currency": "CAD",
            "competitive": r["competitive"], "method_en": None, "method_fr": None, "instrument_en": instrument[0],
            "instrument_fr": instrument[1], "n_amendments": max((r["versions"] or 1) - 1, 0),
            "value_growth": growth(value, r["original"]), "contract_number": numbers[0] if numbers else None,
            "tender_reference": None, "segments": "[]", "provinces": "[]",
        }
        buyers = frozenset([r["buyer_id"]]) if r["buyer_id"] else frozenset()
        out.append(Candidate("contract", f"contract:{reference}", reference, end, row, org, buyers, numbers, value))
    return out


def _same(c: Candidate, k: Candidate) -> bool:
    """The second trigger: organization, buyer, end date within END_DAYS and value within VALUE_SHARE all match."""
    if not c.org or c.org != k.org or not (c.buyers & k.buyers):
        return False
    if abs((c.end - k.end).days) > END_DAYS or c.value is None or k.value is None:
        return False
    return abs(c.value - k.value) <= VALUE_SHARE * max(abs(c.value), abs(k.value))


def dedupe(by_kind: dict[str, list[Candidate]]) -> tuple[list[Candidate], dict[str, int]]:
    """The rows kept, award notices first, then history, then published contracts; and the drops by trigger."""
    kept: list[Candidate] = []
    numbers: set[str] = set()
    by_org: dict[str, list[Candidate]] = defaultdict(list)
    dropped = {"number": 0, "match": 0}
    for kind in KINDS:
        mine: list[Candidate] = []
        for c in by_kind.get(kind, []):
            if any(n in numbers for n in c.numbers):
                dropped["number"] += 1
            elif c.org and any(_same(c, k) for k in by_org.get(c.org, [])):
                dropped["match"] += 1
            else:
                mine.append(c)
        # Rows of one source join the comparison only after it is done, so a
        # source never drops its own rows.
        for c in mine:
            numbers.update(c.numbers)
            if c.org:
                by_org[c.org].append(c)
        kept += mine
    return kept, dropped


def compute(conn: sqlite3.Connection, *, today: date | None = None, now: str | None = None) -> dict[str, int]:
    day = today or datetime.now(timezone.utc).date()
    stamp = now or now_iso()
    first, last = day.isoformat(), (day + timedelta(days=HORIZON_DAYS)).isoformat()
    names = _Names(conn)
    by_kind = {
        "award": notice_candidates(conn, "award", names, first, last, day),
        "history": notice_candidates(conn, "history", names, first, last, day),
        "contract": contract_candidates(conn, names, first, last, day),
    }
    kept, dropped = dedupe(by_kind)
    entered = dict(conn.execute("SELECT source_key, entered_3m FROM expiring_contracts WHERE entered_3m IS NOT NULL"))
    rows = []
    new_in_window = 0
    for c in sorted(kept, key=lambda c: (c.end, KINDS.index(c.kind), c.source_key)):
        row = dict(c.row)
        in_window = row["days_left"] <= FEED_DAYS
        if in_window and c.source_key not in entered:
            new_in_window += 1
        row.update(source_key=c.source_key, entered_3m=(entered.get(c.source_key) or first) if in_window else None,
                   computed_at=stamp)
        rows.append(tuple(row[k] for k in COLUMNS))
    try:
        conn.execute("DELETE FROM expiring_contracts")
        conn.executemany(f"INSERT INTO expiring_contracts ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})",
                         rows)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    counts = {f"candidates_{k}": len(v) for k, v in by_kind.items()}
    counts.update({"kept": len(kept), "dropped_number": dropped["number"], "dropped_match": dropped["match"],
                   "entered_3m": new_in_window})
    for name, days in WINDOWS:
        counts[f"window_{name}"] = sum(1 for c in kept if (c.end - day).days <= days)
    return counts


def run(conn: sqlite3.Connection, *, today: date | None = None, now: str | None = None) -> dict[str, int]:
    counts = compute(conn, today=today, now=now)
    log.info("expiring: %s", counts)
    candidates = sum(v for k, v in counts.items() if k.startswith("candidates_"))
    log_run(conn, "expiring", detail=" ".join(f"{k}={v}" for k, v in counts.items()), rows_in=candidates,
            rows_new=counts["entered_3m"])
    return counts
