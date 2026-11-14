"""How a row of a CanadaBuys file is read: the column each field comes from, and the field normalizers.

Shared by the nightly loader (canadabuys.py), which stores every field, and
the same-day refresh (intraday.py), which reads the new tender notices file
between nightly runs without the database. Both read a notice through
common_fields and tender_fields, so a closing time, a publication date, a
UNSPSC code, a province or a description is the same value whichever of the
two read it. Nothing here touches a database or resolves a buyer: the
caller passes the buyer it resolved, the nightly through buyers.resolve and
the refresh through its lookup.

The headers are bilingual ("title-titre-eng"); a row is one version of a
notice, keyed by its reference number and amendment number (REQUIRED).

A tender notice's documents (attachment-piecesJointes, one column a
language) are links the notice page shows, so only an https link to a
Government of Canada host is kept (government_url); attachments counts the
rest, which the nightly logs and never stores.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import IO
from urllib.parse import unquote, urlsplit

from .. import places
from ..normalize import iso_date, iso_datetime, squash, star_list, tender_status

# The most characters of a description stored, by the table it goes to. A
# longer text is cut at its last whole word within the figure, and the row
# records the cut in description_en_cut and description_fr_cut (the figure,
# 0 for a text stored whole), which the export passes to the site as
# description_cut so a page marks a cut text exactly (description).
#
# Measured on the CanadaBuys files of 2026-11-13: a tender notice's
# description runs to 990 characters at the median, 4,839 at the 90th
# percentile and 75,805 at most, and the 600 kept before cut 22,450 of the
# 31,334 notices (684 of the 943 open). At 10,000, 913 notices are cut (60
# open), the detail shards grow by 84 MB in all and by 91 KB at most each
# (the largest of 64 live shards was 67 KB, against the Worker's 300 KB a
# request), and open-tenders.csv by about 3 MB. Award notices and contract
# history stay at 600: their detail shards (contracts/<abc>.json) averaged
# 239 KB on 2026-11-13 and 6 of 128 sampled were already above 300 KB, so
# every character more would add to the pages over it.
TENDER_DESCRIPTION_MAX = 10_000
DESCRIPTION_MAX = 600
DESCRIPTION_MAX_BY_STAGE = {"tenders": TENDER_DESCRIPTION_MAX, "awards": DESCRIPTION_MAX, "history": DESCRIPTION_MAX}
# A row stored before the cut was recorded holds the first 600 characters,
# cut mid-word, with NULL in both cut columns; the site reads such a text by
# its length (site/src/pages/shared.tsx DESCRIPTION_KEPT_UNMARKED, which a
# site test holds equal to this).
UNMARKED_DESCRIPTION_MAX = 600
# The documents kept for a notice version, at most: a solicitation with more
# is rare, and a detail shard stays small (the Worker parses about 300 KB a request).
ATTACHMENTS_MAX = 50
# Hosts a document link may point at: CanadaBuys and the departments' own
# portals (Shared Services Canada's buying portal is sscp2pspc.ssc-spc.gc.ca).
# The page links each one, so nothing outside the Government of Canada is kept.
GOVERNMENT_HOSTS = ("canada.ca",)
GOVERNMENT_SUFFIXES = (".gc.ca", ".canada.ca")
URL_MAX = 2000

# A row as the loaders read it: the field's name in COLUMNS in, the cell's text (stripped, "" when absent) out.
Getter = Callable[[str], str]

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
        # Comma-separated URLs; a comma inside a file name is written %2C.
        "attachments_en": "attachment-piecesJointes-eng",
        "attachments_fr": "attachment-piecesJointes-fra",
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
# Fields
# ---------------------------------------------------------------------------

def text(value: object) -> str | None:
    return squash(value) or None


def json_list(items: list[str]) -> str | None:
    return json.dumps(items, ensure_ascii=False) if items else None


def description(value: object, limit: int) -> tuple[str | None, int | None]:
    """A description as stored and its cut: (text, 0) when it fits in limit characters, (start, limit) when it
    does not, the start ending at its last whole word within limit; (None, None) for a blank cell.

    The cut looks one character past the limit, so a text whose limit falls on a space keeps the word before
    it. A start with no space in its second half (a long URL) is cut at the limit itself, which a reader still
    sees as cut because the row says so. The scan runs back from the limit, so a long run of spaces costs no
    more than its length."""
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return None, None
    if len(text) <= limit:
        return text, 0
    at = next((i for i in range(limit, -1, -1) if text[i].isspace()), -1)
    kept = text[:at].rstrip() if at > 0 else ""
    return (kept if len(kept) > limit // 2 else text[:limit].rstrip()), limit


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


def aligned(codes: list[str], descs: list[str]) -> list[str | None]:
    # A description list matches its codes only item for item; a list of
    # another length cannot say which description is whose.
    return list(descs) if len(descs) == len(codes) else [None] * len(codes)


# A UNSPSC or GSIN code with the descriptions the row gives it (None where it gives none).
Coded = tuple[str, str | None, str | None]


def common_fields(get: Getter, stage: str = "tenders") -> tuple[dict[str, object], list[Coded], list[Coded]]:
    """The fields every table shares, the version's UNSPSC codes (trimmed, in file order) and its GSIN codes,
    each code with its descriptions. The loader adds source_file to the fields. stage names the table the row
    goes to, which sets how much of a description is kept (DESCRIPTION_MAX_BY_STAGE); the same-day refresh
    reads tender notices, the default."""
    limit = DESCRIPTION_MAX_BY_STAGE[stage]
    description_en, cut_en = description(get("description_en"), limit)
    description_fr, cut_fr = description(get("description_fr"), limit)
    gsins = star_list(get("gsin"))
    gsin_codes = list(zip(gsins, aligned(gsins, star_list(get("gsin_desc_en"))),
                          aligned(gsins, star_list(get("gsin_desc_fr")))))
    raw_codes = star_list(get("unspsc"))
    codes: list[Coded] = []
    for raw, desc_en, desc_fr in zip(raw_codes, aligned(raw_codes, star_list(get("unspsc_desc_en"))),
                                     aligned(raw_codes, star_list(get("unspsc_desc_fr")))):
        code = unspsc_code(raw)
        if code:
            codes.append((code, desc_en, desc_fr))
    delivery_en, delivery_fr = star_list(get("regions_delivery_en")), star_list(get("regions_delivery_fr"))
    rec: dict[str, object] = {
        "solicitation": text(get("solicitation")),
        "title_en": text(get("title_en")),
        "title_fr": text(get("title_fr")),
        "published": iso_date(get("published")),
        "amended": iso_date(get("amended")),
        "gsin": json_list(gsins),
        "gsin_desc_en": json_list(star_list(get("gsin_desc_en"))),
        "gsin_desc_fr": json_list(star_list(get("gsin_desc_fr"))),
        "category": json_list(star_list(get("category"))),
        "notice_type_en": text(get("notice_type_en")),
        "notice_type_fr": text(get("notice_type_fr")),
        "method_en": text(get("method_en")),
        "method_fr": text(get("method_fr")),
        "selection_en": text(get("selection_en")),
        "selection_fr": text(get("selection_fr")),
        "limited_reason_en": text(get("limited_reason_en")),
        "limited_reason_fr": text(get("limited_reason_fr")),
        "trade_agreements_en": json_list(star_list(get("trade_agreements_en"))),
        "trade_agreements_fr": json_list(star_list(get("trade_agreements_fr"))),
        "regions_delivery_en": json_list(delivery_en),
        "regions_delivery_fr": json_list(delivery_fr),
        # provinces, provinces_derived and provinces_from (places.py); a
        # tender's are read again with its regions of opportunity (tender_fields).
        **places.fields(delivery_en + delivery_fr),
        "description_en": description_en,
        "description_fr": description_fr,
        "description_en_cut": cut_en,
        "description_fr_cut": cut_fr,
    }
    return rec, codes, gsin_codes


def tender_fields(get: Getter, buyer_id: str | None) -> dict[str, object]:
    """The fields of a tender notice beyond the common ones, with the buyer the caller resolved. The
    contacts are stored for the operator and never exported. The three province columns replace the common
    ones: a notice whose regions of delivery name nothing reads its regions of opportunity, then, for a
    Defence Construction Canada notice, its regional office (places.derive)."""
    opportunity_en, opportunity_fr = star_list(get("regions_opportunity_en")), star_list(get("regions_opportunity_fr"))
    delivery = star_list(get("regions_delivery_en")) + star_list(get("regions_delivery_fr"))
    office = places.dcc_office_provinces(buyer_id, get("buyer_en"), get("buyer_fr"))
    return {
        "closing": iso_datetime(get("closing")),
        "start_expected": iso_date(get("start_expected")),
        "end_expected": iso_date(get("end_expected")),
        "status": tender_status(get("status") or get("status_fr")),
        "regions_opportunity_en": json_list(opportunity_en),
        "regions_opportunity_fr": json_list(opportunity_fr),
        **places.fields(delivery, opportunity_en + opportunity_fr, office),
        "buyer_id": buyer_id,
        "buyer_raw_en": text(get("buyer_en")),
        "buyer_raw_fr": text(get("buyer_fr")),
        "end_users_en": json_list(entity_list(get("end_users_en"))),
        "end_users_fr": json_list(entity_list(get("end_users_fr"))),
        "contact_name": text(get("contact_name")),
        "contact_email": text(get("contact_email")),
        "contact_phone": text(get("contact_phone")),
    }


# A cell's URLs: split at a comma, a newline or a space only where a scheme
# follows, so a raw comma inside a file name (the files write %2C) does not cut a link.
_URL_SPLIT = re.compile(r"[\s,]+(?=\*?[A-Za-z][A-Za-z0-9+.\-]*:)")


def government_url(raw: object) -> str | None:
    """A document link as the page may show it, or None: https, on a Government of Canada host (canada.ca, a
    *.canada.ca or *.gc.ca name), no user name, password or port but 443, and no "@" anywhere, so no address
    reaches the page through a link."""
    text = str(raw or "").strip().lstrip("*").strip()
    if not text or len(text) > URL_MAX or any(ch.isspace() or ord(ch) < 32 for ch in text):
        return None
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError:
        return None
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme.lower() != "https" or port not in (None, 443) or "@" in parts.netloc:
        return None
    if host not in GOVERNMENT_HOSTS and not host.endswith(GOVERNMENT_SUFFIXES):
        return None
    if "@" in unquote(text):
        return None
    return text


def attachments(get: Getter) -> tuple[list[str], int]:
    """A tender notice version's documents: the English column's links, then the French column's, each URL once
    in file order, ATTACHMENTS_MAX at most; and how many the cells named that government_url refused."""
    kept: list[str] = []
    seen: set[str] = set()
    dropped = 0
    for field in ("attachments_en", "attachments_fr"):
        for piece in _URL_SPLIT.split(get(field)):
            if not piece.strip().lstrip("*").strip():
                continue
            url = government_url(piece)
            if url is None:
                dropped += 1
            elif url not in seen:
                seen.add(url)
                if len(kept) < ATTACHMENTS_MAX:
                    kept.append(url)
    return kept, dropped


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

def open_csv(path: Path) -> IO[str]:
    """A CanadaBuys file opened for reading: the byte-order mark dropped, a stray byte read as U+FFFD."""
    # Descriptions run to tens of kilobytes; the default limit is 128 KiB.
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    return path.open(encoding="utf-8-sig", errors="replace", newline="")


def rows(fh: IO[str], stage: str, source_file: str) -> tuple[list[str], Iterator[Getter]]:
    """The fields of the stage's columns the file lacks, and a getter for each row in file order.

    A file without the reference or amendment column is refused: its layout changed.
    """
    columns = COLUMNS[stage]
    reader = csv.DictReader(fh)
    headers = set(reader.fieldnames or [])
    lacking = [f for f in REQUIRED if columns[f] not in headers]
    if lacking:
        raise ValueError(f"{source_file}: no {', '.join(columns[f] for f in lacking)} column; the layout changed")
    missing = sorted(f for f, h in columns.items() if h not in headers)

    def getters() -> Iterator[Getter]:
        for row in reader:

            def get(f: str, row: dict = row) -> str:
                return (row.get(columns[f]) or "").strip()

            yield get

    return missing, getters()
