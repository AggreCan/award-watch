"""A small database for the export tests: every record kind, the edge cases the export guards against.

Rows go in through the same calls the loaders use (organizations.upsert at
load, organizations.recompute and indicators.compute after), so the export
reads what a real night leaves. The names, references and amounts are made
up. The values a test looks for are module constants.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date

from awardwatch_pipeline import expiring, indicators, organizations

TODAY = date(2026, 10, 31)
STAMP = "2026-10-31T01:00:00Z"
DAY = TODAY.isoformat()

PERSON = "Jane Q Sample"            # a supplier withheld at load: never exported, never in any file
PERSON_STREET = "12 Quiet Lane"
CONTACT_NAME = "Pat Contactperson"
CONTACT_EMAIL = "pat.contact@example.gc.ca"
CONTACT_PHONE = "613-555-0199"
SERVANT = "Robin Buyerofficial"      # the published contracts' buyer_name: a public servant, never exported
SUPPLIER_STREET = "1 Industrial Way"
SUPPLIER_POSTAL = "K1A 0B1"

ACME = "Acme Defence Inc."
NORTH = "Northern Translation Ltd"
FOREIGN = "Overseas Optics GmbH"
SLASH_REF = "23240-220799/001/IM"    # a published reference the site cannot take in a URL as it is
COLON_REF = "SSC-26-00035339:T"
# Contact details publishers write into their own prose: scrubbed from every exported text.
PROSE_EMAIL = "generic.inbox@tpsgc-pwgsc.gc.ca"
PROSE_PHONES = ("613 555 0142", "819.555.0123", "+1 (819) 555-0124 ext. 12", "6135550199", "1-800-555-0100")


def _buyer(conn: sqlite3.Connection, bid: str, en: str, fr: str, acronym: str) -> None:
    conn.execute("INSERT INTO buyers (id, name_en, name_fr, acronym_en, ckan_org, kind, updated_at) "
                 "VALUES (?, ?, ?, ?, ?, 'department', ?)", (bid, en, fr, acronym, bid, STAMP))


def tender(conn: sqlite3.Connection, ref: str, amendment: int, *, title: str, status: str = "open",
           closing: str | None = "2026-11-05T14:00:00", published: str = "2026-10-30", first_seen: str = DAY,
           buyer: str = "pwgsc-tpsgc", solicitation: str | None = None, codes: tuple[str, ...] = ("81111500",),
           provinces: tuple[str, ...] = ("ON",)) -> None:
    conn.execute(
        "INSERT INTO tenders (reference, amendment, solicitation, title_en, title_fr, published, closing, status, "
        "category, notice_type_en, notice_type_fr, method_en, method_fr, provinces, buyer_id, buyer_raw_en, "
        "contact_name, contact_email, contact_phone, description_en, gsin, source_file, first_seen, last_seen) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[\"SRV\"]', 'Request for Proposal', 'Demande de propositions', "
        "'Competitive - Open bidding', 'Concurrentielle - Appel d''offres ouvert', ?, ?, 'Raw buyer', ?, ?, ?, "
        "'Services wanted.', '[\"N7030\"]', 'newTenderNotice.csv', ?, ?)",
        (ref, amendment, solicitation, title, f"{title} (fr)", published, closing, status, json.dumps(list(provinces)),
         buyer, CONTACT_NAME, CONTACT_EMAIL, CONTACT_PHONE, first_seen, first_seen))
    conn.executemany("INSERT INTO tender_codes (reference, amendment, unspsc) VALUES (?, ?, ?)",
                     [(ref, amendment, c) for c in codes])


def award(conn: sqlite3.Connection, ref: str, amendment: int, supplier: str | None, *, value: float,
          awarded: str = "2026-09-15", published: str = "2026-09-16", currency: str = "CAD", status: str = "active",
          buyer: str = "pwgsc-tpsgc", solicitation: str | None = None, codes: tuple[str, ...] = ("81111500",),
          withheld: bool = False, competitive: int | None = 1, first_seen: str = DAY, province: str = "ON",
          country: str = "CA") -> str | None:
    oid = None if withheld else organizations.upsert(conn, supplier, source="awards", country=country,
                                                     province=province, city="Ottawa", postal_code=SUPPLIER_POSTAL)
    conn.execute(
        "INSERT INTO awards (reference, amendment, solicitation, contract_number, title_en, title_fr, published, "
        "awarded, amount, total_value, currency, status, instrument_type_en, competitive, provinces, supplier_raw, "
        "supplier_street, supplier_city, supplier_province, supplier_postal, supplier_country, organization_id, "
        "supplier_withheld, buyer_id, buyer_raw_en, contact_name, contact_email, contact_phone, source_file, "
        "first_seen, last_seen) VALUES (?, ?, ?, 'C-1', ?, ?, ?, ?, ?, ?, ?, ?, 'Contract', ?, '[\"ON\"]', ?, ?, ?, "
        "?, ?, ?, ?, ?, ?, 'Raw buyer', ?, ?, ?, 'award.csv', ?, ?)",
        (ref, amendment, solicitation, f"Award {ref}", f"Attribution {ref}", published, awarded, value, value,
         currency, status, competitive, None if withheld else supplier, None if withheld else SUPPLIER_STREET,
         None if withheld else "Ottawa", province, None if withheld else SUPPLIER_POSTAL, country, oid,
         1 if withheld else 0, buyer, CONTACT_NAME, CONTACT_EMAIL, CONTACT_PHONE, first_seen, first_seen))
    conn.executemany("INSERT INTO award_codes (reference, amendment, unspsc) VALUES (?, ?, ?)",
                     [(ref, amendment, c) for c in codes])
    return oid


def seed(conn: sqlite3.Connection) -> dict[str, str]:
    """Fill conn; returns the organization ids by name."""
    _buyer(conn, "pwgsc-tpsgc", "Public Services and Procurement Canada",
           "Services publics et Approvisionnement Canada", "PSPC")
    _buyer(conn, "dnd-mdn", "National Defence", "Défense nationale", "DND")
    _buyer(conn, "never-buys", "A Buyer With No Record", "Un acheteur sans dossier", "NBR")

    # Tenders: an amended open notice tied to an award by solicitation, one
    # closing within the week, one first seen today but published long ago (the
    # first-load backlog), an expired one, and two references the site cannot
    # take in a URL as published.
    tender(conn, "cb-100-1", 0, title="Translation services", solicitation="SOL-1", first_seen="2026-10-29")
    tender(conn, "cb-100-1", 1, title="Translation services, amended", solicitation="SOL-1", first_seen=DAY,
           closing="2026-11-20T14:00:00", codes=("81111500", "8211"))
    tender(conn, "cb-200-2", 0, title="Hull repair", buyer="dnd-mdn", closing="2026-11-03T14:00:00",
           codes=("72101500",), provinces=("BC",))
    tender(conn, "cb-300-3", 0, title="Old backlog notice", published="2024-01-10", closing="2026-12-31T14:00:00")
    tender(conn, "cb-400-4", 0, title="Expired notice", status="expired", closing="2026-10-01T14:00:00",
           first_seen="2026-10-01", published="2026-09-20")
    tender(conn, COLON_REF, 0, title="Network gear", closing="2026-11-10T14:00:00", codes=("43",))

    ids: dict[str, str] = {}
    ids[ACME] = award(conn, "AW-1", 0, ACME, value=1_000_000.0, buyer="dnd-mdn", codes=("72101500",), competitive=0,
                      awarded="2026-03-02")
    award(conn, "AW-1", 1, "ACME DEFENCE INC", value=1_250_000.0, buyer="dnd-mdn", codes=("72101500",), competitive=0,
          awarded="2026-03-02")
    ids[NORTH] = award(conn, "AW-2", 0, NORTH, value=250_000.0, solicitation="sol-1", awarded="2026-10-20",
                       published="2026-10-21")
    award(conn, "AW-3", 0, NORTH, value=99_000.0, status="cancelled", awarded="2025-05-05", published="2025-05-06")
    ids[FOREIGN] = award(conn, "AW-4", 0, FOREIGN, value=50_000.0, currency="EUR", awarded="2025-02-01",
                         published="2025-02-02", country="DE", province="")
    award(conn, "AW-5", 0, None, value=12_000.0, withheld=True, awarded="2026-08-08", published="2026-08-09")
    award(conn, SLASH_REF, 0, ACME, value=5_000.0, awarded="2024-04-04", published="2024-04-05")

    # Contract history: PSPC on behalf of a client department.
    conn.execute(
        "INSERT INTO contract_history (reference, amendment, procurement_number, title_en, awarded, published, "
        "amount, total_value, currency, status, competitive, supplier_raw, supplier_street, supplier_postal, "
        "supplier_city, supplier_province, supplier_country, organization_id, buyer_id, client_id, client_raw_en, "
        "source_file, first_seen, last_seen) VALUES ('H-1', 0, 'P-9', 'Boots', '2026-06-01', '2026-06-02', 300000, "
        "300000, 'CAD', 'active', 1, ?, ?, ?, 'Ottawa', 'ON', 'CA', ?, 'pwgsc-tpsgc', 'dnd-mdn', "
        "'Department of National Defence (DND)', 'history.csv', ?, ?)",
        (ACME, SUPPLIER_STREET, SUPPLIER_POSTAL, organizations.upsert(conn, ACME, source="history"), DAY, DAY))
    conn.execute(
        "INSERT INTO contract_history (reference, amendment, title_en, awarded, amount, total_value, currency, status, "
        "supplier_raw, supplier_street, supplier_withheld, buyer_id, client_id, source_file, first_seen, last_seen) "
        "VALUES ('H-2', 0, 'Consulting', '2026-07-01', 40000, 40000, 'CAD', 'active', NULL, ?, 1, 'pwgsc-tpsgc', "
        "'dnd-mdn', 'history.csv', ?, ?)", (PERSON_STREET, DAY, DAY))

    # Published contracts: an original and its amendment under one procurement_id.
    for ref, value, original, amendment, kind in (("C-1", 100_000.0, 100_000.0, None, "C"),
                                                  ("C-2", 130_000.0, None, 30_000.0, "A")):
        conn.execute(
            "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, vendor_postal, buyer_id, "
            "buyer_name_raw, contract_date, value, original_value, amendment_value, description_en, "
            "solicitation_procedure, competitive, instrument_type, reporting_period, organization_id, loaded_at) "
            "VALUES ('dnd-mdn', ?, 'PROC-1', ?, ?, 'dnd-mdn', ?, '2025-11-12', ?, ?, ?, 'Translation', 'TN', 0, ?, "
            "'2025-2026-Q3', ?, ?)",
            (ref, NORTH, SUPPLIER_POSTAL, SERVANT, value, original, amendment, kind,
             organizations.upsert(conn, NORTH, source="contracts"), STAMP))

    # Grants: two amendments of one agreement; the highest carries the value.
    for amendment, value in ((0, 10_000.0), (1, 15_000.0)):
        conn.execute(
            "INSERT INTO grants (owner_org, reference, amendment, agreement_type, recipient_type, legal_name, country, "
            "province, city, postal_code, program_en, title_en, value, start, end, buyer_id, organization_id, "
            "loaded_at) VALUES ('dnd-mdn', 'G-1', ?, 'G', 'N', ?, 'CA', 'ON', 'Ottawa', ?, 'Research', 'Study', ?, "
            "'2026-04-01', '2027-03-31', 'dnd-mdn', ?, ?)",
            (amendment, NORTH, SUPPLIER_POSTAL, value, organizations.upsert(conn, NORTH, source="grants"), STAMP))

    conn.execute(
        "INSERT INTO lobbying_communications (comm_number, comm_date, registrant_raw, client_raw, organization_id, "
        "subject_matters, institutions, dpoh, loaded_at) VALUES ('L-1', '2026-05-05', 'A Registered Lobbyist', ?, ?, "
        "'[\"Defence\"]', '[\"National Defence\"]', ?, ?)",
        (ACME, organizations.upsert(conn, ACME, source="lobbying"),
         json.dumps([{"name": "A Public Office Holder", "title": "Deputy Minister", "institution": "National Defence"}]),
         STAMP))
    # The publishers' prose with an officer's contact details in it.
    conn.execute("UPDATE awards SET description_en = ?, description_fr = ? WHERE reference = 'AW-2'",
                 (f"Questions to {PROSE_EMAIL} or 613 555 0142.", f"Questions : {PROSE_EMAIL} ou 819.555.0123."))
    conn.execute("UPDATE tenders SET title_en = title_en || ' (call 1-800-555-0100)', "
                 "description_fr = 'Télécopieur : 6135550199' WHERE reference = 'cb-200-2'")
    conn.execute("UPDATE contracts SET description_en = 'Translation. Fax +1 (819) 555-0124 ext. 12' WHERE reference = 'C-1'")
    conn.execute("UPDATE contract_history SET description_fr = ? WHERE reference = 'H-1'", (f"Écrire à {PROSE_EMAIL}",))
    # End dates for the expiring-contracts radar: within 3, 6 and 12 months of TODAY.
    for table, ref, end in (("awards", "AW-2", "2026-12-15"), ("awards", "AW-1", "2027-06-30"),
                            ("awards", "AW-5", "2026-11-30"), ("awards", SLASH_REF, "2027-02-01"),
                            ("contract_history", "H-1", "2027-01-20")):
        conn.execute(f'UPDATE {table} SET "end" = ? WHERE reference = ?', (end, ref))
    conn.execute("UPDATE contracts SET delivery_date = '2027-03-31', period_start = '2025-11-12'")
    conn.commit()
    organizations.recompute(conn, now=STAMP)
    indicators.compute(conn, now=STAMP)
    expiring.compute(conn, today=TODAY, now=STAMP)
    conn.commit()
    return ids
