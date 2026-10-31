"""Published contracts over $10,000: the contracts stage.

Source: "Proactive Publication - Contracts over $10,000", open.canada.ca
dataset d8f85d91-7dec-4fd1-8055-483b77225d8b, resource
fac950c0-00d5-4ec1-a4d3-9cbebf98a305 (contracts.csv, 655 MB on 2026-10-31),
Open Government Licence - Canada. The Treasury Board Secretariat consolidates
every federal reporting entity's quarterly reports into this one file and
regenerates it whole every day. A row is an original contract or an
amendment. A reference number is unique within one department only, so the
key is the department (owner_org) and the reference number.

Cadence (refresh, shared with the grants stage): the file is checked once
every CHECK_EVERY_DAYS. The time of the last check lives in meta under
"<stage>_loaded_at", because the nightly runner starts with an empty cache.
The check is a conditional request carrying the validators of the copy last
read; a copy whose SHA-256 equals the last one loaded is not parsed again. The
body is streamed to disk, read row by row and deleted.

Loading keeps every row that names a department and a reference. The table is
rewritten whole in one transaction that commits only once the whole file has
been read: a missing required column (checked before anything is written) or
any failure part way leaves the previous rows in place and fails the stage. A
copy refused for its layout is remembered by its validators and checksum, so
the same bytes are not downloaded and refused again on every retry.

The vendor goes through organizations.upsert. A vendor whose name reads as a
person (matching.is_person_name) keeps the row, which is a public spending
record, with its name, postal code and organization withheld (NULL) and
vendor_withheld set; only the count is logged, and the first names are listed
for the operator in data/out/review/contracts-persons.txt. The buyer is the
reporting department (buyers.for_owner_org). The buyer_name column holds the
name of the public servant who bought, so it is never stored.
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import sqlite3
import sys
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from .. import config, organizations
from ..db import get_meta, hours_since, log_run, now_iso, set_meta
from ..http import PoliteClient
from ..normalize import competitive_code, iso_date, money, squash, to_int
from . import buyers, matching

log = logging.getLogger(__name__)
Stats = TypeVar("Stats")

CHECK_EVERY_DAYS = 7
BATCH = 5000
TEXT_MAX = 600
# Seconds between bytes; the whole body may take four times this (http.py).
TIMEOUT_S = 900

# The columns the counting rules and the joins need: a file without one of
# them is refused before anything is written.
REQUIRED = (
    "reference_number", "procurement_id", "vendor_name", "vendor_postal_code", "contract_date", "contract_value",
    "original_value", "amendment_value", "country_of_vendor", "solicitation_procedure", "instrument_type",
    "owner_org", "owner_org_title",
)
# Stored when present; a file lacking one is loaded and the stage says which.
OPTIONAL = (
    "economic_object_code", "description_en", "description_fr", "contract_period_start", "delivery_date",
    "comments_en", "comments_fr", "agreement_type_code", "trade_agreement", "land_claims", "commodity_type",
    "commodity_code", "limited_tendering_reason", "trade_agreement_exceptions", "indigenous_business",
    "indigenous_business_excluding_psib", "intellectual_property", "potential_commercial_exploitation",
    "former_public_servant", "contracting_entity", "standing_offer_number", "ministers_office", "number_of_bids",
    "article_6_exceptions", "award_criteria", "socioeconomic_indicator", "reporting_period",
)

COLUMNS = (
    "owner_org", "reference", "procurement_id", "vendor_raw", "vendor_postal", "vendor_country", "vendor_withheld",
    "buyer_id", "buyer_name_raw", "contracting_entity", "contract_date", "period_start", "delivery_date", "value",
    "original_value", "amendment_value", "economic_object", "description_en", "description_fr", "comments_en",
    "comments_fr", "commodity_type", "commodity_code", "agreement_type", "trade_agreement", "land_claims",
    "solicitation_procedure", "competitive", "limited_tendering_reason", "trade_agreement_exceptions",
    "indigenous_business", "indigenous_business_excluding_psib", "intellectual_property",
    "potential_commercial_exploitation", "former_public_servant", "standing_offer_number", "instrument_type",
    "ministers_office", "number_of_bids", "article_6_exceptions", "award_criteria", "socioeconomic_indicator",
    "reporting_period", "organization_id", "loaded_at",
)


# ---------------------------------------------------------------------------
# Shared with the grants stage: the weekly file, reading rows, the figures
# ---------------------------------------------------------------------------

class LayoutError(ValueError):
    """The file is not laid out the way the loader reads it; the previous rows stay."""


@dataclass(frozen=True)
class WeeklyFile:
    """One big file read whole once a week."""

    stage: str
    url: str
    file_name: str
    sample_name: str
    check_every_days: int = CHECK_EVERY_DAYS

    def key(self, item: str) -> str:
        return f"{self.stage}:{item}"

    @property
    def loaded_key(self) -> str:
        return f"{self.stage}_loaded_at"


@dataclass
class LoadStats:
    rows: int = 0            # data rows read
    written: int = 0         # rows written (a key repeated later in the file replaces the earlier row)
    stored: int = 0          # rows in the table once the load committed
    withheld: int = 0        # rows kept with the organization withheld as a person
    dropped: int = 0         # rows left out entirely (grants to individuals)
    skipped: int = 0         # rows without a key, or cut short
    missing: list[str] = field(default_factory=list)

    @property
    def excluded(self) -> int:
        return self.withheld + self.dropped


@dataclass
class StageResult:
    stage: str
    state: str = ""          # read | unchanged | not due | no sample
    stats: LoadStats | None = None
    notices: list[str] = field(default_factory=list)

    def detail(self) -> str:
        if self.stats is None:
            return self.state
        s = self.stats
        parts = [f"{self.state} rows={s.rows} stored={s.stored} withheld={s.withheld}"]
        if self.stage == "grants":
            parts.append(f"dropped_individuals={s.dropped}")
        parts.append(f"duplicates={s.written - s.stored} skipped={s.skipped}")
        return " ".join(parts)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def cut(value: object) -> str | None:
    """Narrative text, line breaks kept, cut at TEXT_MAX characters."""
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return text[:TEXT_MAX].rstrip() or None


def text(value: object) -> str | None:
    return squash(value) or None


def code_list(value: object) -> str | None:
    """'CA,CL,KR' -> '["CA", "CL", "KR"]'; None for a blank."""
    items = [squash(part) for part in str(value or "").split(",")]
    items = [item for item in items if item]
    return json.dumps(items, ensure_ascii=False) if items else None


def _ends_with_newline(path: Path) -> bool:
    with path.open("rb") as fh:
        fh.seek(0, 2)
        if fh.tell() == 0:
            return True
        fh.seek(-1, 2)
        return fh.read(1) in (b"\n", b"\r")


@contextmanager
def csv_rows(path: Path, required: tuple[str, ...], optional: tuple[str, ...], label: str, stats: LoadStats,
             *, partial_tail: bool = False) -> Iterator[Iterator[Callable[[str], str]]]:
    """The file's rows as getters, after the header is checked; raises LayoutError before any row is read.

    A row with fewer or more fields than the header is skipped and counted,
    since a row that lost or gained a field cannot be read column by column.
    partial_tail is for the samples, byte-cut heads of the real files: when
    the file does not end with a line break its last row is cut somewhere,
    possibly inside its last field, and it is skipped too.
    """
    cut_tail = partial_tail and not _ends_with_newline(path)
    # Descriptions run long; the default limit is 128 KiB.
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    # errors="replace": a stray byte in one name must not stop a 2 GB read.
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as fh:
        reader = csv.DictReader(fh)
        headers = [h.strip() for h in reader.fieldnames or []]
        reader.fieldnames = headers
        lacking = [c for c in required if c not in headers]
        if lacking:
            raise LayoutError(f"{label} lacks {', '.join(lacking)}; the layout changed")
        stats.missing = [c for c in optional if c not in headers]

        def one(row: dict) -> Iterator[Callable[[str], str]]:
            stats.rows += 1
            if None in row or None in row.values():
                stats.skipped += 1
                return

            def get(column: str) -> str:
                return (row.get(column) or "").strip()

            yield get

        def getters() -> Iterator[Callable[[str], str]]:
            held = None
            for row in reader:
                if held is not None:
                    yield from one(held)
                held = row
            if held is not None:
                if cut_tail:
                    stats.rows += 1
                    stats.skipped += 1
                else:
                    yield from one(held)

        yield getters()


def _shown(path: Path) -> str:
    try:
        return path.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def refresh(conn: sqlite3.Connection, client: PoliteClient | None, spec: WeeklyFile,
            load: Callable[[Path], Stats], *, stamp: str, samples: Path | None = None,
            work_dir: Path | None = None) -> tuple[str, Stats | None]:
    """Fetch the file when it is due and changed, and load it; returns the outcome and the load's figures.

    load(path) rewrites the table in one transaction and commits, or rolls
    back and raises. The meta keys are written after it commits. Any failure
    raises, so the stage is logged as failed and tried again on the next run.
    """
    if samples is not None:
        path = samples / spec.sample_name
        if not path.exists():
            return "no sample", None
        digest = sha256(path)
        if digest == get_meta(conn, spec.key("sha256")):
            return "unchanged", None
        stats = load(path)
        # The cadence key is left alone: a samples run says nothing about the real file.
        set_meta(conn, spec.key("sha256"), digest)
        conn.commit()
        return "read", stats

    assert client is not None
    age = hours_since(conn, spec.loaded_key, now=stamp)
    if age is not None and age < spec.check_every_days * 24:
        return "not due", None
    rejected = get_meta(conn, spec.key("rejected"))
    path = (work_dir or config.WORK_DIR) / spec.file_name
    try:
        got = client.download_if_changed(
            spec.url, path, etag=get_meta(conn, spec.key("etag")),
            last_modified=get_meta(conn, spec.key("last_modified")), timeout=TIMEOUT_S,
        )
        if got is None:
            if rejected:
                raise LayoutError(f"{rejected} (the copy refused then has not changed)")
            set_meta(conn, spec.loaded_key, stamp)
            conn.commit()
            return "unchanged", None
        digest = sha256(path)
        if rejected and digest == get_meta(conn, spec.key("rejected_sha256")):
            _record_validators(conn, spec, got.etag, got.last_modified)
            conn.commit()
            raise LayoutError(f"{rejected} (the copy refused then has not changed)")
        if digest == get_meta(conn, spec.key("sha256")):
            # The copy last loaded, back again: nothing to parse, and any
            # refusal since is over.
            _clear_rejected(conn, spec)
            _record_validators(conn, spec, got.etag, got.last_modified)
            set_meta(conn, spec.loaded_key, stamp)
            conn.commit()
            return "unchanged", None
        try:
            stats = load(path)
        except LayoutError as exc:
            # Remember the refused copy, so a retry sends its validators and
            # is answered 304 instead of downloading the same file again.
            set_meta(conn, spec.key("rejected"), str(exc)[:500])
            set_meta(conn, spec.key("rejected_sha256"), digest)
            _record_validators(conn, spec, got.etag, got.last_modified)
            conn.commit()
            raise
        _clear_rejected(conn, spec)
        set_meta(conn, spec.key("sha256"), digest)
        set_meta(conn, spec.key("read_at"), stamp)
        set_meta(conn, spec.loaded_key, stamp)
        _record_validators(conn, spec, got.etag, got.last_modified)
        conn.commit()
        return "read", stats
    finally:
        path.unlink(missing_ok=True)


def _clear_rejected(conn: sqlite3.Connection, spec: WeeklyFile) -> None:
    conn.execute("DELETE FROM meta WHERE key IN (?, ?)", (spec.key("rejected"), spec.key("rejected_sha256")))


def _record_validators(conn: sqlite3.Connection, spec: WeeklyFile, etag: str | None, last_modified: str | None) -> None:
    if etag:
        set_meta(conn, spec.key("etag"), etag)
    if last_modified:
        set_meta(conn, spec.key("last_modified"), last_modified)


def rewrite(conn: sqlite3.Connection, table: str, columns: tuple[str, ...], rows: Iterator[tuple],
            stats: LoadStats) -> None:
    """Replace the table's rows with rows, in batches, inside one transaction; commit only at the end.

    A key repeated later in the file replaces the earlier row. Nothing is
    committed when rows raises; the previous rows come back on the rollback.
    """
    marks = ", ".join("?" * len(columns))
    sql = f"INSERT OR REPLACE INTO {table} ({', '.join(columns)}) VALUES ({marks})"
    try:
        conn.execute(f"DELETE FROM {table}")
        batch: list[tuple] = []
        for row in rows:
            batch.append(row)
            if len(batch) >= BATCH:
                conn.executemany(sql, batch)
                stats.written += len(batch)
                batch.clear()
        if batch:
            conn.executemany(sql, batch)
            stats.written += len(batch)
        if not stats.written:
            raise LayoutError(f"no {table} rows could be read; the previous rows are kept")
        stats.stored = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def finish(conn: sqlite3.Connection, result: StageResult, drops: matching.PersonDrops, *, stamp: str,
           review_dir: Path | None, what: str, withheld: str, samples: Path | None, spec: WeeklyFile) -> None:
    """The stage's notices and its log row."""
    stats = result.stats
    if result.state == "no sample" and samples is not None:
        result.notices.append(f"no {spec.sample_name} in {_shown(samples)} (samples run)")
    if stats is not None:
        review = drops.write((review_dir or config.OUT_DIR / "review") / f"{spec.stage}-persons.txt",
                             what=what, stamp=stamp)
        if review:
            result.notices.append(review.replace("supplier withheld", withheld))
        if stats.missing:
            result.notices.append(f"{spec.file_name} lacks {', '.join(stats.missing)}")
        if stats.skipped:
            result.notices.append(f"{stats.skipped} rows without a key or cut short were skipped")
    made = buyers.take_notices(conn)
    if made:
        shown = "; ".join(made[:15]) + (f" (+{len(made) - 15} more)" if len(made) > 15 else "")
        result.notices.append(f"{len(made)} buyers not in CKAN or the seed: {shown}")
    log_run(conn, spec.stage, detail=result.detail(), rows_in=stats.rows if stats else 0,
            rows_new=stats.stored if stats else 0, excluded=stats.excluded if stats else 0,
            notice=" | ".join(result.notices) or None)


# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------

SPEC = WeeklyFile("contracts", config.CONTRACTS_URL, "contracts.csv", "contracts-head.csv")


def _rows(conn: sqlite3.Connection, getters: Iterator[Callable[[str], str]], stats: LoadStats,
          drops: matching.PersonDrops, stamp: str) -> Iterator[tuple]:
    buyer_cache: dict[str, str] = {}
    for get in getters:
        owner, reference = get("owner_org"), get("reference_number")
        if not owner or not reference:
            stats.skipped += 1
            continue
        if owner not in buyer_cache:
            buyer_cache[owner] = buyers.for_owner_org(conn, owner, get("owner_org_title"), now=stamp)
        name = text(get("vendor_name"))
        if matching.is_placeholder(name):
            name = None
        place = organizations.place_key(get("country_of_vendor"), None, None, get("vendor_postal_code"))
        withheld = bool(name) and matching.is_person_name(name)
        if withheld:
            # A private individual: the record stays and nothing that names or
            # locates the person is written. The country locates no one.
            stats.withheld += 1
            drops.add(name)
            name, postal, org = None, None, None
        else:
            postal = place[3] or None
            org = organizations.upsert(conn, name, source="contracts", country=get("country_of_vendor"),
                                       postal_code=get("vendor_postal_code"), now=stamp) if name else None
        procedure = text(get("solicitation_procedure"))
        rec = {
            "owner_org": owner,
            "reference": reference,
            "procurement_id": text(get("procurement_id")),
            "vendor_raw": name,
            "vendor_postal": postal,
            "vendor_country": place[0] or None,
            "vendor_withheld": 1 if withheld else 0,
            "buyer_id": buyer_cache[owner],
            # The buyer_name column names the public servant who bought: a
            # contact, not a record field, so it is never stored.
            "buyer_name_raw": None,
            "contracting_entity": text(get("contracting_entity")),
            "contract_date": iso_date(get("contract_date")),
            "period_start": iso_date(get("contract_period_start")),
            "delivery_date": iso_date(get("delivery_date")),
            "value": money(get("contract_value")),
            "original_value": money(get("original_value")),
            "amendment_value": money(get("amendment_value")),
            "economic_object": text(get("economic_object_code")),
            "description_en": cut(get("description_en")),
            "description_fr": cut(get("description_fr")),
            "comments_en": cut(get("comments_en")),
            "comments_fr": cut(get("comments_fr")),
            "commodity_type": text(get("commodity_type")),
            "commodity_code": text(get("commodity_code")),
            "agreement_type": text(get("agreement_type_code")),
            "trade_agreement": code_list(get("trade_agreement")),
            "land_claims": text(get("land_claims")),
            "solicitation_procedure": procedure,
            "competitive": competitive_code(procedure),
            "limited_tendering_reason": code_list(get("limited_tendering_reason")),
            "trade_agreement_exceptions": text(get("trade_agreement_exceptions")),
            "indigenous_business": text(get("indigenous_business")),
            "indigenous_business_excluding_psib": text(get("indigenous_business_excluding_psib")),
            "intellectual_property": text(get("intellectual_property")),
            "potential_commercial_exploitation": text(get("potential_commercial_exploitation")),
            "former_public_servant": text(get("former_public_servant")),
            "standing_offer_number": text(get("standing_offer_number")),
            "instrument_type": text(get("instrument_type")),
            "ministers_office": text(get("ministers_office")),
            "number_of_bids": to_int(get("number_of_bids")),
            "article_6_exceptions": text(get("article_6_exceptions")),
            "award_criteria": text(get("award_criteria")),
            "socioeconomic_indicator": text(get("socioeconomic_indicator")),
            "reporting_period": text(get("reporting_period")),
            "organization_id": org,
            "loaded_at": stamp,
        }
        yield tuple(rec[c] for c in COLUMNS)


def load_file(conn: sqlite3.Connection, path: Path, *, now: str | None = None,
              drops: matching.PersonDrops | None = None, label: str = "contracts.csv",
              partial_tail: bool = False) -> LoadStats:
    """Rewrite the contracts table from one copy of contracts.csv, in one transaction."""
    stamp = now or now_iso()
    stats = LoadStats()
    person_drops = drops if drops is not None else matching.PersonDrops()
    with csv_rows(path, REQUIRED, OPTIONAL, label, stats, partial_tail=partial_tail) as getters:
        rewrite(conn, "contracts", COLUMNS, _rows(conn, getters, stats, person_drops, stamp), stats)
    log.info("contracts: %d rows read, %d stored, %d withheld, %d skipped", stats.rows, stats.stored,
             stats.withheld, stats.skipped)
    return stats


def run(conn: sqlite3.Connection, client: PoliteClient | None, *, now: str | None = None,
        samples: Path | None = None, work_dir: Path | None = None, review_dir: Path | None = None) -> StageResult:
    """The contracts stage: check the file weekly, rewrite the table when it changed, log one row."""
    stamp = now or now_iso()
    drops = matching.PersonDrops()
    buyers.take_notices(conn)  # start this stage's list empty
    conn.commit()
    result = StageResult("contracts")
    result.state, result.stats = refresh(
        conn, client, SPEC,
        lambda path: load_file(conn, path, now=stamp, drops=drops, label=SPEC.file_name,
                               partial_tail=samples is not None),
        stamp=stamp, samples=samples, work_dir=work_dir,
    )
    finish(conn, result, drops, stamp=stamp, review_dir=review_dir, what="Published contracts",
           withheld="vendor withheld", samples=samples, spec=SPEC)
    return result
