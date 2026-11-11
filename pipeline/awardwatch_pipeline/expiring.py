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
  organization, end date (within END_DAYS) and value (within VALUE_SHARE) all
  match such a row, whatever the buyer: an award notice names PSPC where the
  department's published contract and PSPC's history name the client, so the
  same contract would otherwise pass twice. Rows of one source are never
  dropped against each other. A published contract's contract numbers are its
  procurement_id and its reference number. Each pair collapsed is listed in
  data/out/review/expiring-duplicates.txt for the operator.
* client_buyer_id and client_buyer_name(_fr) name the client department: the
  department of a published contract dropped against the row, else the
  client of a history record dropped against it, else the row's own (a
  history record's client, a published contract's department, an award
  notice's first end user matched to a buyer through buyer_names, or its
  name as published when none matches).
* value_flag is "check" when value_checks.py flagged the contract
  (value_flags); the value stays, and the export leaves it out of the totals.
* provinces are the ones the newest version's regions of delivery state;
  provinces_derived and provinces_from are the derived ones (places.py): an
  award notice's or history record's as stored, a published contract's from
  its land claims agreement area (published contracts name no region).
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
* indigenous is the published contracts' Indigenous business mark
  (normalize.indigenous_mark): MS or VS for a set-aside under the
  Procurement Strategy for Indigenous Business, IB for an Indigenous business
  outside one, read from the newest row of the group that fills each field; a
  row kept from another source takes the mark of a published contract
  dropped against it. A withheld supplier's row has none.
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
from pathlib import Path

from . import config, organizations, places
from .db import log_run, now_iso
from .normalize import indigenous_mark
from .sources.buyers import public_spelling

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
           "contract_number", "tender_reference", "segments", "provinces", "provinces_derived", "provinces_from",
           "entered_3m", "client_buyer_id", "client_buyer_name", "client_buyer_name_fr", "value_flag", "indigenous",
           "computed_at")
REVIEW_FILE = "expiring-duplicates.txt"


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
    client: tuple[str | None, str | None, str | None] = (None, None, None)   # id, English name, French name


@dataclass(frozen=True)
class Pair:
    """A row the duplicate rule dropped, the kept row it duplicates, and the trigger (number | match)."""
    dropped: Candidate
    kept: Candidate
    trigger: str


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
        # Every spelling a source used for a buyer, so an award notice's end user can be named by its buyer id.
        self.spellings: dict[str, str] = {}
        for raw, bid in conn.execute("SELECT raw_name, buyer_id FROM buyer_names ORDER BY raw_name, source"):
            self.spellings.setdefault(str(raw).strip().casefold(), bid)
        self.flags: set[tuple[str, str]] = {(r[0], r[1]) for r in conn.execute("SELECT kind, key FROM value_flags")}

    def buyer(self, buyer_id: str | None, raw_en: object = None, raw_fr: object = None) -> tuple[str | None, str | None]:
        if buyer_id in self.buyers:
            return self.buyers[buyer_id]
        # A spelling that names or locates a person is never shown.
        return public_spelling(raw_en), public_spelling(raw_fr)

    def client(self, buyer_id: str | None, raw_en: object = None, raw_fr: object = None
               ) -> tuple[str | None, str | None, str | None]:
        """(id, English name, French name) of a client department; the id is None when no buyer matches."""
        en, fr = self.buyer(buyer_id, raw_en, raw_fr)
        return (buyer_id if buyer_id in self.buyers else None), en, fr

    def end_user(self, end_users_en: object, end_users_fr: object) -> tuple[str | None, str | None, str | None]:
        """An award notice's first end user, as a buyer when a source has used that spelling for one."""
        first_en, first_fr = _first(end_users_en), _first(end_users_fr)
        bid = self.spellings.get((first_en or "").casefold()) or self.spellings.get((first_fr or "").casefold())
        if bid:
            return self.client(bid)
        return None, first_en, first_fr


def _first(text: object) -> str | None:
    """The first name of a JSON list column, or None."""
    try:
        items = json.loads(text) if isinstance(text, str) and text else []
    except ValueError:
        return None
    return str(items[0]).strip() or None if isinstance(items, list) and items else None


def notice_candidates(conn: sqlite3.Connection, kind: str, names: _Names, first: str, last: str,
                      today: date) -> list[Candidate]:
    """Award notices (kind 'award') or contract history records ('history') ending between first and last."""
    table, codes = ("awards", "award_codes") if kind == "award" else ("contract_history", "history_codes")
    client = ("n.client_id, n.client_raw_en, n.client_raw_fr, n.procurement_number, NULL AS end_users_en, "
              "NULL AS end_users_fr" if kind == "history"
              else "NULL AS client_id, NULL AS client_raw_en, NULL AS client_raw_fr, NULL AS procurement_number, "
              "n.end_users_en, n.end_users_fr")
    sql = (
        f"WITH newest AS ({organizations._newest_by_reference(table, ('reference',))}) "
        "SELECT n.reference, n.title_en, n.title_fr, n.org, n.supplier_withheld, n.buyer_id, n.buyer_raw_en, "
        f"n.buyer_raw_fr, {client}, n.start, substr(n.\"end\", 1, 10) AS end_day, n.amount, n.total_value, "
        "n.currency, n.competitive, n.method_en, n.method_fr, n.instrument_type_en, n.instrument_type_fr, "
        "n.contract_number, n.solicitation, n.provinces, n.provinces_derived, n.provinces_from, "
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
            "provinces_derived": r["provinces_derived"] or None, "provinces_from": r["provinces_from"] or None,
            "value_flag": "check" if (kind, r["reference"]) in names.flags else None,
            "indigenous": None,
        }
        buyers = frozenset(b for b in (r["buyer_id"], r["client_id"]) if b)
        if kind == "history":
            client = names.client(r["client_id"], *(_first_raw(r["client_raw_en"]), _first_raw(r["client_raw_fr"])))
        else:
            client = names.end_user(r["end_users_en"], r["end_users_fr"])
        out.append(Candidate(kind, f"{kind}:{r['reference']}", r["reference"], end, row, org, buyers, numbers, value,
                             client))
    return out


def _first_raw(text: object) -> str | None:
    """The first department a history record's client column names ("A / B" or a '*' list)."""
    from .sources.canadabuys import entity_list

    names = entity_list(text)
    return names[0] if names else None


def _newest_stated(column: str) -> str:
    """The column's value on the newest row of a published contract's group that fills it."""
    return (f"FIRST_VALUE({column}) OVER (PARTITION BY owner_org, gk ORDER BY COALESCE(TRIM({column}), '') = '', "
            "contract_date DESC, reference DESC)")


def contract_candidates(conn: sqlite3.Connection, names: _Names, first: str, last: str, today: date) -> list[Candidate]:
    """Published contracts ending between first and last, one per department and procurement_id.

    indigenous is the group's mark (normalize.indigenous_mark) from the newest row that fills each of the two
    Indigenous business fields; a withheld vendor carries none, as nothing about a private individual is shown.
    """
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
        "MIN(CASE WHEN instrument_type != 'A' THEN instrument_type END) OVER (PARTITION BY owner_org, gk) AS instrument, "
        f"{_newest_stated('indigenous_business')} AS set_aside, "
        f"{_newest_stated('indigenous_business_excluding_psib')} AS outside_psib "
        "FROM g) "
        "SELECT owner_org, reference, procurement_id, vendor_withheld, organization_id, buyer_id, period_start, "
        "substr(delivery_date, 1, 10) AS end_day, competitive, description_en, description_fr, versions, group_value, "
        "original, instrument, land_claims, set_aside, outside_psib FROM r WHERE rn = 1 "
        "AND substr(delivery_date, 1, 10) BETWEEN ? AND ? ORDER BY end_day, owner_org, reference"
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
        # A published contract names no region of delivery; its land claims
        # agreement area is the one field that places it.
        claimed = places.land_claim_provinces(r["land_claims"])
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
            "provinces_derived": json.dumps(claimed) if claimed else None,
            "provinces_from": places.FROM_LAND_CLAIMS if claimed else None,
            "value_flag": "check" if ("contract", f"{r['owner_org']}:{r['procurement_id']}") in names.flags else None,
            "indigenous": None if withheld else indigenous_mark(r["set_aside"], r["outside_psib"]),
        }
        buyers = frozenset([r["buyer_id"]]) if r["buyer_id"] else frozenset()
        out.append(Candidate("contract", f"contract:{reference}", reference, end, row, org, buyers, numbers, value,
                             names.client(r["buyer_id"])))
    return out


def _same(c: Candidate, k: Candidate) -> bool:
    """The second trigger: organization, end date within END_DAYS and value within VALUE_SHARE all match.

    The buyer is not compared: an award notice names PSPC, the contracting
    entity, where the department's published contract and PSPC's history name
    the client, so one contract reads as two buyers.
    """
    if not c.org or c.org != k.org:
        return False
    if abs((c.end - k.end).days) > END_DAYS or c.value is None or k.value is None:
        return False
    return abs(c.value - k.value) <= VALUE_SHARE * max(abs(c.value), abs(k.value))


def dedupe(by_kind: dict[str, list[Candidate]]) -> tuple[list[Candidate], dict[str, int], list[Pair]]:
    """The rows kept, award notices first, then history, then published contracts; the drops by trigger; the pairs."""
    kept: list[Candidate] = []
    numbers: dict[str, Candidate] = {}
    by_org: dict[str, list[Candidate]] = defaultdict(list)
    dropped = {"number": 0, "match": 0}
    pairs: list[Pair] = []
    for kind in KINDS:
        mine: list[Candidate] = []
        for c in by_kind.get(kind, []):
            twin = next((numbers[n] for n in c.numbers if n in numbers), None)
            if twin is not None:
                dropped["number"] += 1
                pairs.append(Pair(c, twin, "number"))
                continue
            twin = next((k for k in by_org.get(c.org, []) if _same(c, k)), None) if c.org else None
            if twin is not None:
                dropped["match"] += 1
                pairs.append(Pair(c, twin, "match"))
                continue
            mine.append(c)
        # Rows of one source join the comparison only after it is done, so a
        # source never drops its own rows.
        for c in mine:
            for n in c.numbers:
                numbers.setdefault(n, c)
            if c.org:
                by_org[c.org].append(c)
        kept += mine
    return kept, dropped, pairs


def clients(kept: list[Candidate], pairs: list[Pair]) -> dict[str, tuple[str | None, str | None, str | None]]:
    """Each kept row's client department: a dropped published contract's department, else a dropped history
    record's client, else the row's own."""
    twins: dict[str, list[Candidate]] = defaultdict(list)
    for p in pairs:
        twins[p.kept.source_key].append(p.dropped)
    out = {}
    for c in kept:
        side = sorted(twins.get(c.source_key, []), key=lambda d: (-KINDS.index(d.kind), d.source_key))
        named = [d.client for d in side if d.client[0] or d.client[1]]
        out[c.source_key] = named[0] if named else c.client
    return out


def indigenous_marks(kept: list[Candidate], pairs: list[Pair]) -> dict[str, str | None]:
    """Each kept row's Indigenous business mark: its own (a published contract's), else that of a published
    contract the duplicate rule dropped against it, the first by key. A row whose supplier is withheld has none."""
    twins: dict[str, list[Candidate]] = defaultdict(list)
    for p in pairs:
        if p.dropped.kind == "contract" and p.dropped.row.get("indigenous"):
            twins[p.kept.source_key].append(p.dropped)
    out: dict[str, str | None] = {}
    for c in kept:
        own = c.row.get("indigenous")
        if own or c.row.get("supplier_withheld"):
            out[c.source_key] = own
            continue
        side = sorted(twins.get(c.source_key, []), key=lambda d: d.source_key)
        out[c.source_key] = side[0].row["indigenous"] if side else None
    return out


def write_review(pairs: list[Pair], path: Path, *, stamp: str) -> str | None:
    """Write (or, with no pair, remove) the operator's list of the pairs the duplicate rule collapsed."""
    if not pairs:
        path.unlink(missing_ok=True)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)

    def money(v: float | None) -> str:
        return "" if v is None else f"{v:.2f}"

    lines = [f"# Expiring-contracts radar, run of {stamp}: {len(pairs)} rows dropped as duplicates of a kept row "
             "(trigger number: the same contract number; match: the same organization, end date within "
             f"{END_DAYS} days and value within {VALUE_SHARE:.0%}). For the operator: no step publishes this file.",
             "# trigger\tdropped\tdropped_buyer\tdropped_end\tdropped_value\tkept\tkept_buyer\tkept_end\tkept_value"
             "\torganization_id"]
    for p in sorted(pairs, key=lambda p: (p.kept.source_key, p.dropped.source_key)):
        d, k = p.dropped, p.kept
        lines.append("\t".join((p.trigger, d.source_key, d.row.get("buyer_id") or "", d.end.isoformat(),
                                money(d.value), k.source_key, k.row.get("buyer_id") or "", k.end.isoformat(),
                                money(k.value), k.org or "")))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        shown = path.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        shown = str(path)
    return f"{len(pairs)} radar rows dropped as duplicates; the pairs are listed in {shown}"


def compute(conn: sqlite3.Connection, *, today: date | None = None, now: str | None = None,
            review_dir: Path | None = None) -> dict[str, int]:
    """Rebuild expiring_contracts; returns the counts."""
    return _build(conn, today=today, now=now, review_dir=review_dir)[0]


def _build(conn: sqlite3.Connection, *, today: date | None, now: str | None,
           review_dir: Path | None) -> tuple[dict[str, int], str | None]:
    day = today or datetime.now(timezone.utc).date()
    stamp = now or now_iso()
    first, last = day.isoformat(), (day + timedelta(days=HORIZON_DAYS)).isoformat()
    names = _Names(conn)
    by_kind = {
        "award": notice_candidates(conn, "award", names, first, last, day),
        "history": notice_candidates(conn, "history", names, first, last, day),
        "contract": contract_candidates(conn, names, first, last, day),
    }
    kept, dropped, pairs = dedupe(by_kind)
    client = clients(kept, pairs)
    marks = indigenous_marks(kept, pairs)
    entered = dict(conn.execute("SELECT source_key, entered_3m FROM expiring_contracts WHERE entered_3m IS NOT NULL"))
    rows = []
    new_in_window = 0
    for c in sorted(kept, key=lambda c: (c.end, KINDS.index(c.kind), c.source_key)):
        row = dict(c.row)
        in_window = row["days_left"] <= FEED_DAYS
        if in_window and c.source_key not in entered:
            new_in_window += 1
        cid, cen, cfr = client[c.source_key]
        row.update(source_key=c.source_key, entered_3m=(entered.get(c.source_key) or first) if in_window else None,
                   client_buyer_id=cid, client_buyer_name=cen, client_buyer_name_fr=cfr,
                   indigenous=marks[c.source_key], computed_at=stamp)
        rows.append(tuple(row[k] for k in COLUMNS))
    try:
        conn.execute("DELETE FROM expiring_contracts")
        conn.executemany(f"INSERT INTO expiring_contracts ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})",
                         rows)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    notice = write_review(pairs, (review_dir or config.OUT_DIR / "review") / REVIEW_FILE, stamp=stamp)
    counts = {f"candidates_{k}": len(v) for k, v in by_kind.items()}
    counts.update({"kept": len(kept), "dropped_number": dropped["number"], "dropped_match": dropped["match"],
                   "entered_3m": new_in_window})
    for name, days in WINDOWS:
        counts[f"window_{name}"] = sum(1 for c in kept if (c.end - day).days <= days)
    return counts, notice


def run(conn: sqlite3.Connection, *, today: date | None = None, now: str | None = None,
        review_dir: Path | None = None) -> dict[str, int]:
    counts, notice = _build(conn, today=today, now=now, review_dir=review_dir)
    log.info("expiring: %s", counts)
    candidates = sum(v for k, v in counts.items() if k.startswith("candidates_"))
    log_run(conn, "expiring", detail=" ".join(f"{k}={v}" for k, v in counts.items()), rows_in=candidates,
            rows_new=counts["entered_3m"], notice=notice)
    return counts
