"""Federal grants and contributions: the grants stage.

Source: "Proactive Disclosure - Grants and Contributions", open.canada.ca
dataset 432527ab-7aac-45b5-81d6-7597107a7013, resource
1d15a62f-5656-49ad-8c88-f40ce689d831 (grants.csv, 2.4 GB on 2026-10-31),
Open Government Licence - Canada. Federal departments disclose their grant
and contribution agreements each quarter; the file is one row per agreement
version (department, reference number, amendment number): recipient type,
business number, legal and operating name, address, riding, program,
agreement type, value and dates. It is regenerated whole every day.

Cadence and transaction rules are the contracts stage's (contracts.refresh):
checked weekly with a conditional request, streamed to disk, read row by row,
deleted, and the table rewritten whole in one transaction that commits only
once the whole file has been read.

Every organizational row is kept, one row per version; the highest amendment
carries the amended value (CLAUDE.md "Counting money"). Recipient type P
(individuals, and sole proprietorships filed as such) is left out entirely and
only counted. Any other recipient whose legal name reads as a person
(matching.is_person_name) keeps the row with its legal and operating names,
business number, city, postal code and organization withheld (NULL) and
recipient_withheld set; the first names are listed for the operator in
data/out/review/grants-persons.txt. An operating name that reads as a person
is not kept. A field written in both languages ("English|French") keeps its
first part. Narrative fields are cut at 600 characters.
"""

from __future__ import annotations

import logging
import math
import sqlite3
from collections.abc import Callable, Iterator
from pathlib import Path

from .. import config, organizations
from ..db import now_iso
from ..http import PoliteClient
from ..normalize import business_number, iso_date, province_code, to_int
from . import buyers, matching
from .contracts import LoadStats, StageResult, WeeklyFile, csv_rows, cut, finish, refresh, rewrite, text

log = logging.getLogger(__name__)

SPEC = WeeklyFile("grants", config.GRANTS_URL, "grants.csv", "grants-head.csv")
CHECK_EVERY_DAYS = SPEC.check_every_days
REQUIRED = (
    "ref_number", "amendment_number", "agreement_type", "recipient_type", "recipient_business_number",
    "recipient_legal_name", "recipient_operating_name", "recipient_country", "recipient_province",
    "recipient_city", "recipient_postal_code", "prog_name_en", "prog_name_fr", "agreement_value",
    "agreement_start_date", "agreement_end_date", "owner_org", "owner_org_title",
)
OPTIONAL = (
    "amendment_date", "research_organization_name", "federal_riding_name_en", "federal_riding_name_fr",
    "federal_riding_number", "agreement_title_en", "agreement_title_fr", "agreement_number",
    "foreign_currency_type", "foreign_currency_value", "naics_identifier", "description_en", "description_fr",
)
COLUMNS = (
    "owner_org", "reference", "amendment", "amendment_date", "agreement_type", "recipient_type", "business_number",
    "legal_name", "operating_name", "research_organization", "country", "province", "city", "postal_code",
    "recipient_withheld", "riding_en", "riding_fr", "riding_number", "program_en", "program_fr", "title_en",
    "title_fr", "agreement_number", "value", "fx_type", "fx_value", "start", "end", "naics", "description_en",
    "description_fr", "buyer_id", "organization_id", "loaded_at",
)


def _value(raw: str | None) -> float | None:
    try:
        value = float((raw or "").replace(",", "").replace("$", "").strip())
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _city_and_province(city: str, province: str | None) -> tuple[str | None, str | None]:
    """Older rows write the province into the city ("Headingley, Manitoba") and leave the province blank."""
    if "," in city:
        head, tail = city.rsplit(",", 1)
        code = province_code(tail.strip())
        if code in matching.PROVINCE_CODES:
            return head.strip() or None, province or code
    return city or None, province


def _organization_name(raw: str) -> str | None:
    """A second name on the row, kept only when it is not blank, a placeholder or a person's name."""
    name = matching.business_name(raw)
    return None if not name or matching.is_placeholder(name) else name


def _rows(conn: sqlite3.Connection, getters: Iterator[Callable[[str], str]], stats: LoadStats,
          drops: matching.PersonDrops, stamp: str) -> Iterator[tuple]:
    buyer_cache: dict[str, str] = {}
    for get in getters:
        owner, reference = get("owner_org"), get("ref_number")
        if not owner or not reference:
            stats.skipped += 1
            continue
        kind = get("recipient_type").upper()
        if kind == "P":
            # Declared an individual: nothing of the row is kept, only the count.
            stats.dropped += 1
            continue
        if owner not in buyer_cache:
            buyer_cache[owner] = buyers.for_owner_org(conn, owner, get("owner_org_title"), now=stamp)
        legal = matching.first_language(get("recipient_legal_name"))
        if matching.is_placeholder(legal):
            legal = ""
        operating = _organization_name(get("recipient_operating_name"))
        postal = matching.postal_code(get("recipient_postal_code"))
        city, province = _city_and_province(matching.first_language(get("recipient_city")),
                                            matching.province_of(get("recipient_province"), postal))
        place = organizations.place_key(get("recipient_country"), province, city,
                                        postal or get("recipient_postal_code"))
        number = business_number(get("recipient_business_number"))
        withheld = bool(legal) and matching.is_person_name(legal)
        if withheld:
            # A sole proprietor filed under another type: the agreement stays,
            # and nothing that names or locates the person is written. Their
            # business number would name them through the registry, so it goes
            # too; the country and province locate no one.
            stats.withheld += 1
            drops.add(legal)
            legal_out = operating = number = None
            city_out = postal_out = org = None
        else:
            legal_out, city_out, postal_out = legal or None, place[2] or None, place[3] or None
            org = organizations.upsert(conn, legal, source="grants", country=get("recipient_country"),
                                       province=province, city=city, postal_code=postal or get("recipient_postal_code"),
                                       now=stamp) if legal else None
            if org and operating and operating != legal:
                # The operating name is a second spelling of the recipient, counted
                # the way upsert counts one split off a legal name.
                organizations._count_name(conn, org, operating, "grants")
        research = _organization_name(get("research_organization_name"))
        rec = {
            "owner_org": owner,
            "reference": reference,
            "amendment": to_int(get("amendment_number")) or 0,
            "amendment_date": iso_date(get("amendment_date")),
            "agreement_type": text(get("agreement_type").upper()),
            "recipient_type": kind or None,
            "business_number": number,
            "legal_name": legal_out,
            "operating_name": operating,
            "research_organization": research,
            "country": place[0] or None,
            "province": place[1] or None,
            "city": city_out,
            "postal_code": postal_out,
            "recipient_withheld": 1 if withheld else 0,
            "riding_en": text(get("federal_riding_name_en")),
            "riding_fr": text(get("federal_riding_name_fr")),
            "riding_number": text(get("federal_riding_number")),
            "program_en": text(get("prog_name_en")),
            "program_fr": text(get("prog_name_fr")),
            "title_en": cut(get("agreement_title_en")),
            "title_fr": cut(get("agreement_title_fr")),
            "agreement_number": text(get("agreement_number")),
            "value": _value(get("agreement_value")),
            "fx_type": text(get("foreign_currency_type").upper()),
            "fx_value": _value(get("foreign_currency_value")),
            "start": iso_date(get("agreement_start_date")),
            "end": iso_date(get("agreement_end_date")),
            "naics": text(get("naics_identifier")),
            "description_en": cut(get("description_en")),
            "description_fr": cut(get("description_fr")),
            "buyer_id": buyer_cache[owner],
            "organization_id": org,
            "loaded_at": stamp,
        }
        yield tuple(rec[c] for c in COLUMNS)


def load_file(conn: sqlite3.Connection, path: Path, *, now: str | None = None,
              drops: matching.PersonDrops | None = None, label: str = "grants.csv",
              partial_tail: bool = False) -> LoadStats:
    """Rewrite the grants table from one copy of grants.csv, in one transaction."""
    stamp = now or now_iso()
    stats = LoadStats()
    person_drops = drops if drops is not None else matching.PersonDrops()
    with csv_rows(path, REQUIRED, OPTIONAL, label, stats, partial_tail=partial_tail) as getters:
        rewrite(conn, "grants", COLUMNS, _rows(conn, getters, stats, person_drops, stamp), stats)
    # Only counts are logged, never a name.
    log.info("grants: %d rows read, %d stored, %d withheld, %d individuals left out, %d skipped", stats.rows,
             stats.stored, stats.withheld, stats.dropped, stats.skipped)
    return stats


def run(conn: sqlite3.Connection, client: PoliteClient | None, *, now: str | None = None,
        samples: Path | None = None, work_dir: Path | None = None, review_dir: Path | None = None) -> StageResult:
    """The grants stage: check the file weekly, rewrite the table when it changed, log one row."""
    stamp = now or now_iso()
    drops = matching.PersonDrops()
    buyers.take_notices(conn)
    conn.commit()
    result = StageResult("grants")
    result.state, result.stats = refresh(
        conn, client, SPEC,
        lambda path: load_file(conn, path, now=stamp, drops=drops, label=SPEC.file_name,
                               partial_tail=samples is not None),
        stamp=stamp, samples=samples, work_dir=work_dir,
    )
    finish(conn, result, drops, stamp=stamp, review_dir=review_dir, what="Grants and contributions",
           withheld="recipient withheld", samples=samples, spec=SPEC)
    return result
