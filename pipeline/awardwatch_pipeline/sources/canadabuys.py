"""CanadaBuys tender notices, award notices and PSPC contract history: the tenders, awards and history stages.

Source: CanadaBuys open data, Public Services and Procurement Canada, Open
Government Licence, Canada (open.canada.ca datasets
6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2 tender notices,
a1acb126-9ce8-40a9-b889-5da2b1dd20cb award notices and
4fe645a1-ffcd-40c1-9385-2c771be956a4 contract history). Each is a set of CSV
files with bilingual headers ("title-titre-eng"); a row is one version of a
notice, keyed by its reference number and amendment number.

Which files a run reads (plan):

* tenders: yesterday's new notices and every open notice, nightly; the
  complete file (every notice since 2022-08-08) on the first load and again
  once the copy last read is seven days old. The legacy 2009-2022 file names
  no supplier and is not loaded.
* awards: the current fiscal year's file nightly; the complete file on the
  first load and weekly as above; the legacy 2012-2022 file on the first load.
* history: the same shape (the fiscal-year file, the complete file since
  2023-06, the legacy 2009-2023 file). The host's Last-Modified decides
  whether the monthly fiscal-year file is new.

Every file is fetched with a conditional request carrying the validators of
the copy last read, streamed to disk, and deleted after the load; one whose
SHA-256 equals the last copy read is not parsed again. The validators, the
checksum and the time read are kept in meta under "canadabuys:<file>:".

Loading (load_file) streams the file row by row. A version is upserted:
first_seen is set when it is inserted, last_seen and source_file on every
sight; nothing is deleted when a version leaves a file. The supplier of an
award or history row goes through organizations.upsert. A supplier whose name
reads as a person (matching.is_person_name) keeps the row, which is a public
spending record, with the supplier withheld: its name, street, city, postal
code and organization are stored NULL and supplier_withheld is 1. Only the
count goes to the run log (rule 3); the first names are listed for the
operator in data/out/review/<stage>-persons.txt. The contracting entity and a
contract's client department go through buyers.resolve; a spelling that names
no institution (a contracting officer's name, a job title, an address) leaves
the record with no buyer and is listed in the same review file, never in the
log. UNSPSC codes go to the *_codes tables and unspsc_codes
(trimmed to their significant digits: 81110000 is the family 8111), GSIN
codes to gsin_codes, and the delivery regions to provinces through
normalize.region_provinces. Descriptions are cut at 600 characters. Contacts
are stored for the operator and never exported.

Tender status comes from the file. After the open file is read, an open
tender absent from it whose closing has passed becomes expired; the weekly
complete pass, read before the open file, corrects any status the file states
otherwise (cancelled, awarded). The open file itself keeps some notices for
months after their closing; the exports read every notice's status on the
data date (normalize.tender_status_on), which calls those closed.
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import re
import sqlite3
import sys
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from .. import config, organizations
from ..db import get_meta, log_run, now_iso, set_meta
from ..http import FetchError, PoliteClient
from ..normalize import (
    award_status, competitive, iso_date, iso_datetime, money, region_provinces, squash, star_list,
    tender_status, to_int,
)
from . import buyers, matching

log = logging.getLogger(__name__)

STAGES = ("tenders", "awards", "history")
TABLES = {"tenders": "tenders", "awards": "awards", "history": "contract_history"}
CODE_TABLES = {"tenders": "tender_codes", "awards": "award_codes", "history": "history_codes"}
COMPLETE_EVERY = timedelta(days=7)
DESCRIPTION_MAX = 600
COMMIT_EVERY = 20_000
# Seconds between bytes; the whole body may take four times this (http.py).
TIMEOUT_S = 900
SEGMENTS_PATH = config.PACKAGE_DATA / "unspsc_segments.csv"

# ---------------------------------------------------------------------------
# Columns: the field each table stores, and the header it is read from.
# ---------------------------------------------------------------------------

_COMMON = {
    "title_en": "title-titre-eng",
    "title_fr": "title-titre-fra",
    "reference": "referenceNumber-numeroReference",
    "amendment": "amendmentNumber-numeroModification",
    "solicitation": "solicitationNumber-numeroSollicitation",
    "published": "publicationDate-datePublication",
    "amended": "amendmentDate-dateModification",
    "gsin": "gsin-nibs",
    "gsin_desc_en": "gsinDescription-nibsDescription-eng",
    "gsin_desc_fr": "gsinDescription-nibsDescription-fra",
    "unspsc": "unspsc",
    "unspsc_desc_en": "unspscDescription-eng",
    "unspsc_desc_fr": "unspscDescription-fra",
    "category": "procurementCategory-categorieApprovisionnement",
    "notice_type_en": "noticeType-avisType-eng",
    "notice_type_fr": "noticeType-avisType-fra",
    "method_en": "procurementMethod-methodeApprovisionnement-eng",
    "method_fr": "procurementMethod-methodeApprovisionnement-fra",
    "selection_en": "selectionCriteria-criteresSelection-eng",
    "selection_fr": "selectionCriteria-criteresSelection-fra",
    "limited_reason_en": "limitedTenderingReason-raisonAppelOffresLimite-eng",
    "limited_reason_fr": "limitedTenderingReason-raisonAppelOffresLimite-fra",
    "trade_agreements_en": "tradeAgreements-accordsCommerciaux-eng",
    "trade_agreements_fr": "tradeAgreements-accordsCommerciaux-fra",
    "regions_delivery_en": "regionsOfDelivery-regionsLivraison-eng",
    "regions_delivery_fr": "regionsOfDelivery-regionsLivraison-fra",
    "buyer_en": "contractingEntityName-nomEntitContractante-eng",
    "buyer_fr": "contractingEntityName-nomEntitContractante-fra",
    "end_users_en": "endUserEntitiesName-nomEntitesUtilisateurFinal-eng",
    "end_users_fr": "endUserEntitiesName-nomEntitesUtilisateurFinal-fra",
}
_CONTACTS = {
    "contact_name": "contactInfoName-informationsContactNom",
    "contact_email": "contactInfoEmail-informationsContactCourriel",
    "contact_phone": "contactInfoPhone-contactInfoTelephone",
}
_CONTRACT = {
    "contract_number": "contractNumber-numeroContrat",
    "awarded": "contractAwardDate-dateAttributionContrat",
    "start": "contractStartDate-contratDateDebut",
    "end": "contractEndDate-dateFinContrat",
    "amount": "contractAmount-montantContrat",
    "total_value": "totalContractValue-valeurTotaleContrat",
    "currency": "contractCurrency-contratMonnaie",
    "instrument_type_en": "instrumentType-typeInstrument-eng",
    "instrument_type_fr": "instrumentType-typeInstrument-fra",
    "amendment_type_en": "amendmentType-typeModification-eng",
    "amendment_type_fr": "amendmentType-typeModification-fra",
    "supplier_en": "supplierLegalName-nomLegalFournisseur-eng",
    "supplier_fr": "supplierLegalName-nomLegalFournisseur-fra",
    "supplier_street": "supplierAddressLine-ligneAdresseFournisseur-eng",
    "supplier_city": "supplierAddressCity-fournisseurAdresseVille-eng",
    "supplier_province": "supplierAddressProvince-fournisseurAdresseProvince-eng",
    "supplier_postal": "supplierAddressPostalCode-fournisseurAdresseCodePostal",
    "supplier_country": "supplierAddressCountry-fournisseurAdressePays-eng",
}
COLUMNS: dict[str, dict[str, str]] = {
    "tenders": {
        **_COMMON, **_CONTACTS,
        "closing": "tenderClosingDate-appelOffresDateCloture",
        "start_expected": "expectedContractStartDate-dateDebutContratPrevue",
        "end_expected": "expectedContractEndDate-dateFinContratPrevue",
        "status": "tenderStatus-appelOffresStatut-eng",
        "status_fr": "tenderStatus-appelOffresStatut-fra",
        "regions_opportunity_en": "regionsOfOpportunity-regionAppelOffres-eng",
        "regions_opportunity_fr": "regionsOfOpportunity-regionAppelOffres-fra",
        "description_en": "tenderDescription-descriptionAppelOffres-eng",
        "description_fr": "tenderDescription-descriptionAppelOffres-fra",
    },
    "awards": {
        **_COMMON, **_CONTRACT, **_CONTACTS,
        "status": "awardStatus-attributionStatut-eng",
        "status_fr": "awardStatus-attributionStatut-fra",
        "description_en": "awardDescription-descriptionAttribution-eng",
        "description_fr": "awardDescription-descriptionAttribution-fra",
    },
    "history": {
        **_COMMON, **_CONTRACT,
        "status": "contractStatus-statutContrat-eng",
        "status_fr": "contractStatus-statutContrat-fra",
        "procurement_number": "procurementNumber-numeroApprovisionnement",
        "n_records": "numberOfRecords-nombreEnregistrements",
        "supplier_standardized": "supplierStandardizedName-nomNormaliseFournisseur-eng",
        "supplier_operating": "supplierOperatingName-nomCommercialFournisseur-eng",
        "supplier_employee_count": "supplierEmployeeCount-fournisseurNombreEmployes-eng",
        "description_en": "tenderDescription-descriptionAppelOffres-eng",
        "description_fr": "tenderDescription-descriptionAppelOffres-fra",
    },
}
REQUIRED = ("reference", "amendment")


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SourceFile:
    stage: str
    kind: str  # new | open | fy | complete | legacy
    name: str

    @property
    def url(self) -> str:
        return config.CANADABUYS_BASE + self.name


def fiscal_year(day: date) -> str:
    """'2026-2027' for any day from 2026-04-01 to 2027-03-31: the federal fiscal year."""
    start = day.year if day.month >= 4 else day.year - 1
    return f"{start}-{start + 1}"


def files_for(stage: str, day: date) -> dict[str, SourceFile]:
    fy = fiscal_year(day)
    names = {
        "tenders": {"complete": config.TENDERS_COMPLETE_FILE, "new": config.TENDERS_NEW_FILE,
                    "open": config.TENDERS_OPEN_FILE},
        "awards": {"legacy": config.AWARDS_LEGACY_FILE, "complete": config.AWARDS_COMPLETE_FILE,
                   "fy": config.AWARDS_FY_FILE.format(fy=fy)},
        "history": {"legacy": config.HISTORY_LEGACY_FILE, "complete": config.HISTORY_COMPLETE_FILE,
                    "fy": config.HISTORY_FY_FILE.format(fy=fy)},
    }[stage]
    return {kind: SourceFile(stage, kind, name) for kind, name in names.items()}


def _meta_key(name: str, item: str) -> str:
    return f"canadabuys:{name}:{item}"


def _http_date(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        when = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def _iso(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        when = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def complete_due(conn: sqlite3.Connection, name: str, now: datetime) -> bool:
    """True when the complete file was never read, or the copy last read is seven days old or more.

    Its age is the host's Last-Modified for that copy, else the time it was read.
    """
    when = _http_date(get_meta(conn, _meta_key(name, "last_modified"))) or _iso(get_meta(conn, _meta_key(name, "read_at")))
    return when is None or now - when >= COMPLETE_EVERY


def plan(conn: sqlite3.Connection, stage: str, now: datetime) -> list[SourceFile]:
    """The files a stage reads tonight, in the order it reads them (the newest snapshot last)."""
    files = files_for(stage, now.date())
    first_load = conn.execute(f"SELECT 1 FROM {TABLES[stage]} LIMIT 1").fetchone() is None
    out: list[SourceFile] = []
    # Read on the first load, and again once after the person test changed
    # (matching.refresh_person_test), so its withheld rows are recomputed.
    reread = stage in (get_meta(conn, matching.REREAD_LEGACY_KEY) or "").split(",")
    if (first_load or reread) and "legacy" in files:
        out.append(files["legacy"])
    if first_load or complete_due(conn, files["complete"].name, now):
        out.append(files["complete"])
    out += [files[kind] for kind in ("new", "open", "fy") if kind in files]
    return out


_SAMPLE_PATTERNS: dict[str, list[tuple[str, str]]] = {
    "tenders": [("complete", "tenderNoticeComplete*.csv"), ("new", "newTenderNotice*.csv"),
                ("open", "openTenderNotice*.csv")],
    "awards": [("legacy", "*awardNoticeHistorical*.csv"), ("complete", "awardNoticeComplete*.csv"),
               ("fy", "[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-awardNotice*.csv")],
    "history": [("legacy", "*contractHistoryHistorical*.csv"), ("complete", "contractHistoryComplete*.csv"),
                ("fy", "[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-contractHistory*.csv")],
}


def sample_files(stage: str, folder: Path) -> list[tuple[SourceFile, Path]]:
    """The sample files standing in for a stage's files, each under the file name it stands in for."""
    out: list[tuple[SourceFile, Path]] = []
    for kind, pattern in _SAMPLE_PATTERNS[stage]:
        for path in sorted(folder.glob(pattern)):
            if kind == "fy":
                fy = path.name[:9]
                name = (config.AWARDS_FY_FILE if stage == "awards" else config.HISTORY_FY_FILE).format(fy=fy)
            else:
                name = files_for(stage, date(2026, 4, 1))[kind].name
            out.append((SourceFile(stage, kind, name), path))
    return out


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------

def _text(value: object) -> str | None:
    return squash(value) or None


def _json(items: list[str]) -> str | None:
    return json.dumps(items, ensure_ascii=False) if items else None


def _cut(value: object) -> str | None:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return text[:DESCRIPTION_MAX].rstrip() or None


def entity_list(value: object) -> list[str]:
    """End-user entities: a '*' list, or names joined by ' / ' as the award and history files write them."""
    text = str(value or "").strip()
    if text.startswith("*"):
        return star_list(text)
    return [squash(part) for part in text.split(" / ") if squash(part)]


def unspsc_code(raw: object) -> str | None:
    """'*81110000' -> '8111': the significant digits (2 segment, 4 family, 6 class, 8 commodity)."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if not digits or len(digits) > 8 or len(digits) % 2:
        return None
    while len(digits) > 2 and digits.endswith("00"):
        digits = digits[:-2]
    return None if digits == "00" else digits


def _aligned(codes: list[str], descs: list[str]) -> list[str | None]:
    # A description list matches its codes only item for item; a list of
    # another length cannot say which description is whose.
    return list(descs) if len(descs) == len(codes) else [None] * len(codes)


@dataclass
class FileStats:
    rows: int = 0
    new: int = 0
    excluded: int = 0
    skipped: int = 0
    redacted: int = 0  # withheld names replaced in titles and descriptions
    missing: list[str] = field(default_factory=list)
    # Rows per buyer spelling (English, French) that resolved to no buyer.
    unbought: Counter = field(default_factory=Counter)
    # Kept for the open-notices file only: the status step needs its references,
    # and a legacy file's would be a million strings held for nothing.
    collect_references: bool = False
    references: set[str] = field(default_factory=set)


@dataclass
class _Context:
    """What one file's load shares across its rows."""

    conn: sqlite3.Connection
    stage: str
    source_file: str
    day: str
    stamp: str
    drops: matching.PersonDrops
    buyer_cache: dict[tuple[str, str], str | None] = field(default_factory=dict)
    unspsc: dict[str, tuple[str | None, str | None]] = field(default_factory=dict)
    gsin: dict[str, tuple[str | None, str | None]] = field(default_factory=dict)
    sql: dict[tuple, str] = field(default_factory=dict)
    unbought: Counter = field(default_factory=Counter)

    def buyer(self, en: object, fr: object) -> str | None:
        key = (squash(en), squash(fr))
        if key not in self.buyer_cache:
            self.buyer_cache[key] = buyers.resolve(self.conn, key[0], key[1], now=self.stamp)
        found = self.buyer_cache[key]
        if found is None and (key[0] or key[1]):
            self.unbought[key] += 1
        return found


def _common(ctx: _Context, get: Callable[[str], str]) -> tuple[dict[str, object], list[tuple[str, str | None, str | None]]]:
    """The fields every table shares, and the version's UNSPSC codes with their descriptions."""
    gsins = star_list(get("gsin"))
    for code, desc_en, desc_fr in zip(gsins, _aligned(gsins, star_list(get("gsin_desc_en"))),
                                      _aligned(gsins, star_list(get("gsin_desc_fr")))):
        have = ctx.gsin.get(code, (None, None))
        ctx.gsin[code] = (have[0] or desc_en, have[1] or desc_fr)
    raw_codes = star_list(get("unspsc"))
    codes: list[tuple[str, str | None, str | None]] = []
    for raw, desc_en, desc_fr in zip(raw_codes, _aligned(raw_codes, star_list(get("unspsc_desc_en"))),
                                     _aligned(raw_codes, star_list(get("unspsc_desc_fr")))):
        code = unspsc_code(raw)
        if code:
            codes.append((code, desc_en, desc_fr))
    delivery_en, delivery_fr = star_list(get("regions_delivery_en")), star_list(get("regions_delivery_fr"))
    rec: dict[str, object] = {
        "solicitation": _text(get("solicitation")),
        "title_en": _text(get("title_en")),
        "title_fr": _text(get("title_fr")),
        "published": iso_date(get("published")),
        "amended": iso_date(get("amended")),
        "gsin": _json(gsins),
        "gsin_desc_en": _json(star_list(get("gsin_desc_en"))),
        "gsin_desc_fr": _json(star_list(get("gsin_desc_fr"))),
        "category": _json(star_list(get("category"))),
        "notice_type_en": _text(get("notice_type_en")),
        "notice_type_fr": _text(get("notice_type_fr")),
        "method_en": _text(get("method_en")),
        "method_fr": _text(get("method_fr")),
        "selection_en": _text(get("selection_en")),
        "selection_fr": _text(get("selection_fr")),
        "limited_reason_en": _text(get("limited_reason_en")),
        "limited_reason_fr": _text(get("limited_reason_fr")),
        "trade_agreements_en": _json(star_list(get("trade_agreements_en"))),
        "trade_agreements_fr": _json(star_list(get("trade_agreements_fr"))),
        "regions_delivery_en": _json(delivery_en),
        "regions_delivery_fr": _json(delivery_fr),
        "provinces": _json(region_provinces(delivery_en + delivery_fr)),
        "description_en": _cut(get("description_en")),
        "description_fr": _cut(get("description_fr")),
        "source_file": ctx.source_file,
    }
    return rec, codes


def _tender(ctx: _Context, get: Callable[[str], str], rec: dict[str, object]) -> None:
    rec.update({
        "closing": iso_datetime(get("closing")),
        "start_expected": iso_date(get("start_expected")),
        "end_expected": iso_date(get("end_expected")),
        "status": tender_status(get("status") or get("status_fr")),
        "regions_opportunity_en": _json(star_list(get("regions_opportunity_en"))),
        "regions_opportunity_fr": _json(star_list(get("regions_opportunity_fr"))),
        "buyer_id": ctx.buyer(get("buyer_en"), get("buyer_fr")),
        "buyer_raw_en": _text(get("buyer_en")),
        "buyer_raw_fr": _text(get("buyer_fr")),
        "end_users_en": _json(entity_list(get("end_users_en"))),
        "end_users_fr": _json(entity_list(get("end_users_fr"))),
        "contact_name": _text(get("contact_name")),
        "contact_email": _text(get("contact_email")),
        "contact_phone": _text(get("contact_phone")),
    })


def _supplier(get: Callable[[str], str]) -> tuple[str | None, tuple[str, str, str, str], str | None]:
    """The supplier's name, its address as organizations key it, and the street."""
    name = _text(get("supplier_en")) or _text(get("supplier_fr"))
    if matching.is_placeholder(name):
        name = None
    place = organizations.place_key(get("supplier_country"), get("supplier_province"), get("supplier_city"),
                                    get("supplier_postal"))
    return name, place, _text(get("supplier_street"))


def _contract(ctx: _Context, get: Callable[[str], str], rec: dict[str, object]) -> None:
    rec.update({
        "contract_number": _text(get("contract_number")),
        "awarded": iso_date(get("awarded")),
        "start": iso_date(get("start")),
        "end": iso_date(get("end")),
        "amount": money(get("amount")),
        "total_value": money(get("total_value")),
        "currency": _text(get("currency").upper()),
        "status": award_status(get("status") or get("status_fr")),
        "instrument_type_en": _text(get("instrument_type_en")),
        "instrument_type_fr": _text(get("instrument_type_fr")),
        "amendment_type_en": _text(get("amendment_type_en")),
        "amendment_type_fr": _text(get("amendment_type_fr")),
        "competitive": competitive(get("method_en")),
    })


def _award(ctx: _Context, get: Callable[[str], str], rec: dict[str, object]) -> None:
    _contract(ctx, get, rec)
    rec.update({
        "buyer_id": ctx.buyer(get("buyer_en"), get("buyer_fr")),
        "buyer_raw_en": _text(get("buyer_en")),
        "buyer_raw_fr": _text(get("buyer_fr")),
        "end_users_en": _json(entity_list(get("end_users_en"))),
        "end_users_fr": _json(entity_list(get("end_users_fr"))),
        "contact_name": _text(get("contact_name")),
        "contact_email": _text(get("contact_email")),
        "contact_phone": _text(get("contact_phone")),
    })


def _history(ctx: _Context, get: Callable[[str], str], rec: dict[str, object]) -> None:
    _contract(ctx, get, rec)
    clients_en, clients_fr = entity_list(get("end_users_en")), entity_list(get("end_users_fr"))
    # The client is the first end-user department named; a contract for
    # several keeps them all in client_raw. The French list is not always in
    # the English order, so its first name goes with the English one only
    # when each list names one department (or there is no English list).
    first_en = clients_en[0] if clients_en else ""
    paired = len(clients_fr) == 1 and len(clients_en) <= 1
    first_fr = clients_fr[0] if clients_fr and (paired or not clients_en) else ""
    standardized = _text(get("supplier_standardized"))
    operating = _text(get("supplier_operating"))
    rec.update({
        "procurement_number": _text(get("procurement_number")),
        "n_records": to_int(get("n_records")),
        "supplier_standardized": standardized if standardized and not matching.is_person_name(standardized) else None,
        "supplier_operating": operating if operating and not matching.is_person_name(operating) else None,
        "supplier_employee_count": _text(get("supplier_employee_count")),
        "buyer_id": ctx.buyer(get("buyer_en"), get("buyer_fr")),
        "buyer_raw_en": _text(get("buyer_en")),
        "buyer_raw_fr": _text(get("buyer_fr")),
        "client_id": ctx.buyer(first_en, first_fr) if (first_en or first_fr) else None,
        "client_raw_en": _text(get("end_users_en")),
        "client_raw_fr": _text(get("end_users_fr")),
    })


_BUILDERS = {"tenders": _tender, "awards": _award, "history": _history}
_SUPPLIER_FIELDS = ("supplier_raw", "supplier_country", "supplier_province", "supplier_city", "supplier_postal")
# The free text of a version that may name its supplier ("TSPS SA (Task
# Based) - <name>"): the field, whether it is French, and how it is stored.
_FREE_TEXT: tuple[tuple[str, bool, Callable[[object], str | None]], ...] = (
    ("title_en", False, _text), ("title_fr", True, _text),
    ("description_en", False, _cut), ("description_fr", True, _cut),
)


def _persons_named(stage: str, get: Callable[[str], str], name: str | None, withheld: bool) -> list[str]:
    """The private individuals a version names: its withheld supplier, and (history) an operating or
    standardized name the person test dropped."""
    persons = [name] if withheld and name else []
    if stage == "history":
        persons += [n for n in (_text(get("supplier_standardized")), _text(get("supplier_operating")))
                    if n and matching.is_person_name(n)]
    return persons


def _redact_free_text(get: Callable[[str], str], rec: dict[str, object], persons: list[str]) -> int:
    """Replace the persons' names in the version's titles and descriptions, read again from the file
    so a name is replaced before a description is cut; returns the replacements made."""
    total = 0
    for column, french, store in _FREE_TEXT:
        text, n = matching.redact(get(column), persons, french=french)
        if n:
            rec[column] = store(text)
            total += n
    return total


def _redact_other_versions(conn: sqlite3.Connection, table: str, key: tuple[str, int], persons: list[str]) -> int:
    """The same in the versions of the reference stored earlier: a later run that withholds the
    supplier must not leave the name in an older version's title, nor as that version's supplier
    (a version missing from tonight's files is not read again)."""
    columns = [c for c, _, _ in _FREE_TEXT]
    folded = {squash(p).casefold() for p in persons}
    total = 0
    for row in conn.execute(f"SELECT amendment, supplier_raw, {', '.join(columns)} FROM {table} "
                            "WHERE reference = ? AND amendment != ?", key).fetchall():
        changed: dict[str, object] = {}
        for (column, french, _), value in zip(_FREE_TEXT, tuple(row)[2:]):
            text, n = matching.redact(value, persons, french=french)
            if n:
                changed[column] = text
                total += n
        if row[1] and squash(row[1]).casefold() in folded:
            changed.update({"supplier_raw": None, "supplier_street": None, "supplier_city": None,
                            "supplier_postal": None, "organization_id": None, "supplier_withheld": 1})
            if table == "contract_history":
                changed.update({"supplier_standardized": None, "supplier_operating": None})
        if changed:
            conn.execute(f"UPDATE {table} SET {', '.join(f'{c} = ?' for c in changed)} WHERE reference = ? AND amendment = ?",
                         (*changed.values(), key[0], row[0]))
    return total


def _upsert_sql(ctx: _Context, table: str, cols: tuple[str, ...]) -> str:
    key = (table, cols)
    if key not in ctx.sql:
        quoted = ", ".join(f'"{c}"' for c in cols)
        marks = ", ".join("?" * (len(cols) + 4))
        updates = ", ".join(f'"{c}" = excluded."{c}"' for c in cols)
        ctx.sql[key] = (
            f"INSERT INTO {table} (reference, amendment, {quoted}, first_seen, last_seen) VALUES ({marks}) "
            f"ON CONFLICT(reference, amendment) DO UPDATE SET {updates}, last_seen = excluded.last_seen"
        )
    return ctx.sql[key]


def _load_row(ctx: _Context, get: Callable[[str], str], stats: FileStats) -> None:
    conn, stage, table = ctx.conn, ctx.stage, TABLES[ctx.stage]
    reference = squash(get("reference"))
    if not reference:
        stats.skipped += 1
        return
    key = (reference, to_int(get("amendment")) or 0)
    if stats.collect_references:
        stats.references.add(reference)
    supplied = stage != "tenders"
    if supplied:
        prev = conn.execute(
            f"SELECT {', '.join(_SUPPLIER_FIELDS)}, organization_id FROM {table} WHERE reference = ? AND amendment = ?",
            key,
        ).fetchone()
        name, place, street = _supplier(get)
        withheld = bool(name) and matching.is_person_name(name)
    else:
        prev = conn.execute(f"SELECT 1 FROM {table} WHERE reference = ? AND amendment = ?", key).fetchone()

    rec, codes = _common(ctx, get)
    _BUILDERS[stage](ctx, get, rec)
    if supplied and withheld:
        # A private individual: the record stays, and nothing that names or
        # locates the person is written (a version stored before the test read
        # it so is overwritten the same way). The country and province stay;
        # they locate no one.
        stats.excluded += 1
        ctx.drops.add(name)
        rec.update({
            "supplier_raw": None, "supplier_street": None, "supplier_country": place[0] or None,
            "supplier_province": place[1] or None, "supplier_city": None, "supplier_postal": None,
            "organization_id": None, "supplier_withheld": 1,
        })
        if stage == "history":
            rec.update({"supplier_standardized": None, "supplier_operating": None})
        persons = _persons_named(stage, get, name, True)
        stats.redacted += _redact_free_text(get, rec, persons) + _redact_other_versions(conn, table, key, persons)
    elif supplied:
        persons = _persons_named(stage, get, name, False)
        if persons:
            stats.redacted += _redact_free_text(get, rec, persons)
        current = (name, *(v or None for v in place))
        if prev is not None and tuple(prev)[:5] == current:
            org = prev[5]
        else:
            org = organizations.upsert(conn, name, source=stage, country=place[0], province=place[1],
                                       city=place[2], postal_code=place[3], now=ctx.stamp) if name else None
        rec.update({
            "supplier_raw": name, "supplier_street": street, "supplier_country": place[0] or None,
            "supplier_province": place[1] or None, "supplier_city": place[2] or None,
            "supplier_postal": place[3] or None, "organization_id": org, "supplier_withheld": 0,
        })
    cols = tuple(rec)
    conn.execute(_upsert_sql(ctx, table, cols), (*key, *rec.values(), ctx.day, ctx.day))
    if prev is None:
        stats.new += 1
    conn.execute(f"DELETE FROM {CODE_TABLES[stage]} WHERE reference = ? AND amendment = ?", key)
    conn.executemany(
        f"INSERT OR IGNORE INTO {CODE_TABLES[stage]} (reference, amendment, unspsc) VALUES (?, ?, ?)",
        [(*key, code) for code, _, _ in codes],
    )
    for code, desc_en, desc_fr in codes:
        have = ctx.unspsc.get(code, (None, None))
        ctx.unspsc[code] = (have[0] or desc_en, have[1] or desc_fr)


def _flush_codes(ctx: _Context) -> None:
    ctx.conn.executemany(
        "INSERT INTO unspsc_codes (code, level, desc_en, desc_fr, n) VALUES (?, ?, ?, ?, 0) ON CONFLICT(code) DO UPDATE "
        "SET desc_en = COALESCE(unspsc_codes.desc_en, excluded.desc_en), "
        "desc_fr = COALESCE(unspsc_codes.desc_fr, excluded.desc_fr)",
        [(code, len(code) // 2, en, fr) for code, (en, fr) in ctx.unspsc.items()],
    )
    ctx.conn.executemany(
        "INSERT INTO gsin_codes (code, desc_en, desc_fr, n) VALUES (?, ?, ?, 0) ON CONFLICT(code) DO UPDATE "
        "SET desc_en = COALESCE(gsin_codes.desc_en, excluded.desc_en), "
        "desc_fr = COALESCE(gsin_codes.desc_fr, excluded.desc_fr)",
        [(code, en, fr) for code, (en, fr) in ctx.gsin.items()],
    )
    ctx.unspsc.clear()
    ctx.gsin.clear()


def load_file(conn: sqlite3.Connection, stage: str, path: Path, source_file: str, *,
              now: str | None = None, collect_references: bool = False,
              drops: matching.PersonDrops | None = None) -> FileStats:
    """Read one CanadaBuys file into its stage's table; the caller decides whether it needs reading."""
    stamp = now or now_iso()
    ctx = _Context(conn, stage, source_file, stamp[:10], stamp, drops if drops is not None else matching.PersonDrops())
    stats = FileStats(collect_references=collect_references)
    columns = COLUMNS[stage]
    # Descriptions run to tens of kilobytes; the default limit is 128 KiB.
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as fh:
        reader = csv.DictReader(fh)
        headers = set(reader.fieldnames or [])
        lacking = [f for f in REQUIRED if columns[f] not in headers]
        if lacking:
            raise ValueError(f"{source_file}: no {', '.join(columns[f] for f in lacking)} column; the layout changed")
        stats.missing = sorted(f for f, h in columns.items() if h not in headers)

        for row in reader:

            def get(f: str, row: dict = row) -> str:
                return (row.get(columns[f]) or "").strip()

            stats.rows += 1
            _load_row(ctx, get, stats)
            if stats.rows % COMMIT_EVERY == 0:
                _flush_codes(ctx)
                conn.commit()
    _flush_codes(ctx)
    conn.commit()
    stats.unbought = ctx.unbought
    return stats


# ---------------------------------------------------------------------------
# After the files: statuses and code counts
# ---------------------------------------------------------------------------

def _passed(closing: str, now: str) -> bool:
    # A closing given as a date alone lasts the whole day.
    if len(closing) == 10:
        return closing < now[:10]
    return closing < now[:19]


def expire_closed(conn: sqlite3.Connection, open_references: set[str], now: str) -> int:
    """Open tenders missing from tonight's open file whose closing has passed become expired."""
    rows = conn.execute(
        "SELECT reference, amendment, closing FROM tenders WHERE status = 'open' AND closing IS NOT NULL"
    ).fetchall()
    gone = [(ref, amd) for ref, amd, closing in rows if ref not in open_references and _passed(closing, now)]
    conn.executemany("UPDATE tenders SET status = 'expired' WHERE reference = ? AND amendment = ?", gone)
    conn.commit()
    return len(gone)


def seed_segments(conn: sqlite3.Connection, path: Path | None = None) -> int:
    src = path or SEGMENTS_PATH
    lines = [line for line in src.read_text(encoding="utf-8").splitlines() if not line.startswith("#")]
    rows = [(r["code"].strip(), r["desc_en"].strip(), r["desc_fr"].strip()) for r in csv.DictReader(lines)]
    conn.executemany(
        "INSERT INTO unspsc_codes (code, level, desc_en, desc_fr, n) VALUES (?, 1, ?, ?, 0) "
        "ON CONFLICT(code) DO UPDATE SET level = 1, desc_en = excluded.desc_en, desc_fr = excluded.desc_fr",
        rows,
    )
    return len(rows)


def recount_codes(conn: sqlite3.Connection) -> None:
    """unspsc_codes.n: the notice versions carrying a code or one under it; gsin_codes.n likewise."""
    counts = dict(conn.execute(
        """
        WITH codes AS (
          SELECT 't' AS k, reference, amendment, unspsc AS c FROM tender_codes
          UNION ALL SELECT 'a', reference, amendment, unspsc FROM award_codes
          UNION ALL SELECT 'h', reference, amendment, unspsc FROM history_codes
        ), prefixes AS (
          SELECT k, reference, amendment, substr(c, 1, 2) AS p FROM codes
          UNION SELECT k, reference, amendment, substr(c, 1, 4) FROM codes WHERE length(c) >= 4
          UNION SELECT k, reference, amendment, substr(c, 1, 6) FROM codes WHERE length(c) >= 6
          UNION SELECT k, reference, amendment, c FROM codes WHERE length(c) = 8
        )
        SELECT p, COUNT(*) FROM prefixes GROUP BY p
        """
    ))
    conn.execute("UPDATE unspsc_codes SET n = 0 WHERE n != 0")
    conn.executemany("UPDATE unspsc_codes SET n = ? WHERE code = ?", [(n, code) for code, n in counts.items()])
    gsin = dict(conn.execute(
        "SELECT j.value, COUNT(*) FROM (SELECT gsin FROM tenders WHERE gsin IS NOT NULL "
        "UNION ALL SELECT gsin FROM awards WHERE gsin IS NOT NULL "
        "UNION ALL SELECT gsin FROM contract_history WHERE gsin IS NOT NULL) t, json_each(t.gsin) j GROUP BY j.value"
    ))
    conn.execute("UPDATE gsin_codes SET n = 0 WHERE n != 0")
    conn.executemany("UPDATE gsin_codes SET n = ? WHERE code = ?", [(n, code) for code, n in gsin.items()])
    conn.commit()


# ---------------------------------------------------------------------------
# A stage
# ---------------------------------------------------------------------------

@dataclass
class StageStats:
    stage: str
    read: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    rows: int = 0
    new: int = 0
    excluded: int = 0
    skipped: int = 0
    expired: int = 0
    redacted: int = 0
    notices: list[str] = field(default_factory=list)

    def detail(self) -> str:
        parts = [f"read={','.join(self.read) or 'none'}"]
        if self.unchanged:
            parts.append(f"unchanged={','.join(self.unchanged)}")
        parts.append(f"rows={self.rows} new={self.new} withheld={self.excluded} skipped={self.skipped}")
        if self.stage == "tenders":
            parts.append(f"expired={self.expired}")
        else:
            parts.append(f"redacted={self.redacted}")
        return " ".join(parts)


def _record_validators(conn: sqlite3.Connection, name: str, etag: str | None, last_modified: str | None) -> None:
    if etag:
        set_meta(conn, _meta_key(name, "etag"), etag)
    if last_modified:
        set_meta(conn, _meta_key(name, "last_modified"), last_modified)


def _buyer_notice(lines: list[str]) -> str | None:
    if not lines:
        return None
    shown = "; ".join(lines[:15])
    more = f" (+{len(lines) - 15} more)" if len(lines) > 15 else ""
    return f"{len(lines)} buyer spellings not in the seed or CKAN: {shown}{more}"


def run(conn: sqlite3.Connection, client: PoliteClient | None, stage: str, *, now: str | None = None,
        samples: Path | None = None, work_dir: Path | None = None, review_dir: Path | None = None) -> StageStats:
    """One CanadaBuys stage: plan, fetch, load, then statuses, code counts and the log row.

    With samples, the files are read from that folder and nothing is fetched.
    The names the person test withheld are listed in review_dir (default
    data/out/review), never in the log row.
    """
    stamp = now or now_iso()
    current = _iso(stamp) or datetime.now(timezone.utc)
    stats = StageStats(stage)
    drops = matching.PersonDrops()
    unbought: Counter = Counter()
    buyers.take_notices(conn)  # start this stage's lists empty
    buyers.take_rejects(conn)
    seed_segments(conn)
    if samples is not None:
        todo = [(f, path) for f, path in sample_files(stage, samples)]
    else:
        todo = [(f, None) for f in plan(conn, stage, current)]
    folder = work_dir or config.WORK_DIR
    open_refs: set[str] | None = None

    for f, sample_path in todo:
        etag = last_modified = None
        if sample_path is not None:
            path, downloaded = sample_path, False
        else:
            assert client is not None
            path, downloaded = folder / f.name, True
            try:
                got = client.download_if_changed(
                    f.url, path, etag=get_meta(conn, _meta_key(f.name, "etag")),
                    last_modified=get_meta(conn, _meta_key(f.name, "last_modified")), timeout=TIMEOUT_S,
                )
            except FetchError as exc:
                if exc.status == 404 and f.kind == "fy":
                    stats.notices.append(f"{f.name} is not published yet")
                    continue
                raise
            if got is None:
                stats.unchanged.append(f.name)
                continue
            etag, last_modified = got.etag, got.last_modified
        try:
            digest = _sha256(path)
            if digest == get_meta(conn, _meta_key(f.name, "sha256")):
                _record_validators(conn, f.name, etag, last_modified)
                conn.commit()
                stats.unchanged.append(f.name)
                continue
            fs = load_file(conn, stage, path, f.name, now=stamp, collect_references=f.kind == "open", drops=drops)
        finally:
            if downloaded:
                path.unlink(missing_ok=True)
        log.info("%s %s: %d rows, %d new, %d excluded", stage, f.name, fs.rows, fs.new, fs.excluded)
        stats.read.append(f.name)
        stats.rows += fs.rows
        stats.new += fs.new
        stats.excluded += fs.excluded
        stats.skipped += fs.skipped
        stats.redacted += fs.redacted
        unbought.update(fs.unbought)
        if fs.missing:
            stats.notices.append(f"{f.name} lacks {', '.join(fs.missing)}")
        if f.kind == "open":
            open_refs = fs.references
        set_meta(conn, _meta_key(f.name, "sha256"), digest)
        set_meta(conn, _meta_key(f.name, "read_at"), stamp)
        _record_validators(conn, f.name, etag, last_modified)
        if f.kind == "legacy":
            pending = [s for s in (get_meta(conn, matching.REREAD_LEGACY_KEY) or "").split(",") if s and s != stage]
            set_meta(conn, matching.REREAD_LEGACY_KEY, ",".join(pending))
        conn.commit()

    if stage == "tenders" and open_refs is not None:
        stats.expired = expire_closed(conn, open_refs, stamp)
    if stats.read:
        recount_codes(conn)
    # The names the person test withheld (no supplier on a tender) and the
    # buyer spellings that name no institution, for the operator only.
    rejected = buyers.take_rejects(conn)
    spellings = {spelling for _, spelling in rejected}
    review = drops.write((review_dir or config.OUT_DIR / "review") / f"{stage}-persons.txt",
                         what=f"CanadaBuys {stage}", stamp=stamp, buyers=rejected,
                         buyer_rows=sum(n for key, n in unbought.items() if key[0] in spellings or key[1] in spellings))
    if review:
        stats.notices.append(review)
    notice = _buyer_notice(buyers.take_notices(conn))
    if notice:
        stats.notices.append(notice)
    log_run(conn, stage, detail=stats.detail(), rows_in=stats.rows, rows_new=stats.new, excluded=stats.excluded,
            notice=" | ".join(stats.notices) or None)
    return stats
