"""A withheld supplier, vendor, recipient or client is also taken out of its record's free text.

The names are the invented persons of the fixtures (Ana Ferreira on an award,
Laura Holloway on a published contract, Daniel Ashdale on a grant and a
lobbying report); the texts are written around them in the shapes the files
use ("TSPS SA (Task Based) - <name>").
"""

import csv
import json
import zipfile

import pytest

from awardwatch_pipeline.sources import buyers, canadabuys, contracts, grants, lobbying, matching

csv.field_size_limit(2**31 - 1)
DAY1, DAY2 = "2026-10-30T01:00:00Z", "2026-10-31T01:00:00Z"


@pytest.fixture
def seeded_conn(conn):
    # The lobbying loader resolves institutions, which needs the buyer seed.
    buyers.load_seed(conn, buyers.read_seed(), now=DAY1)
    return conn


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        return reader.fieldnames, list(reader)


def write_csv(path, header, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)
    return path


def test_every_order_of_the_name_with_or_without_a_title_is_replaced():
    text = ("Services by Ms. Laura Holloway; see HOLLOWAY, Laura and Holloway,Laura. Laura Hollowayville is a place. "
            "Another Laura stays.")
    redacted, n = matching.redact(text, ["Laura Holloway"])
    assert n == 3
    assert redacted == ("Services by [name withheld]; see [name withheld] and [name withheld]. Laura Hollowayville "
                        "is a place. Another Laura stays.")
    assert matching.redact("Contrat avec Mme Laura Holloway", ["Holloway, Laura"], french=True) == \
        ("Contrat avec [nom retiré]", 1)
    # Two people in one name, and nothing to replace in a text that names neither.
    assert matching.redact("Laura Holloway and Daniel Ashdale", ["Laura Holloway, Daniel Ashdale"])[1] == 2
    assert matching.redact("Accessibility audit", ["Laura Holloway"]) == ("Accessibility audit", 0)


def test_an_award_title_naming_its_withheld_supplier_is_redacted_now_and_in_versions_stored_earlier(
        conn, fixtures, tmp_path, monkeypatch):
    header, rows = read_csv(fixtures / "canadabuys_awards.csv")
    base = next(r for r in rows if r["referenceNumber-numeroReference"] == "cb-000-00000001")
    texts = {
        "title-titre-eng": "TSPS SA (Task Based) - Ana Ferreira",
        "title-titre-fra": "SPTS AMA (en fonction des tâches) - FERREIRA, Ana",
        "awardDescription-descriptionAttribution-eng": "Task authorizations issued to Ms. Ana Ferreira.",
    }
    v0 = dict(base, **texts, **{"amendmentNumber-numeroModification": "000"})
    v1 = dict(v0, **{"amendmentNumber-numeroModification": "001"})
    # An earlier run read the supplier as a business (an older person test) and stored both versions under her name.
    with monkeypatch.context() as m:
        m.setattr(matching, "is_person_name", lambda name: False)
        canadabuys.load_file(conn, "awards", write_csv(tmp_path / "a.csv", header, [v0, v1]), "fy.csv", now=DAY1)
    assert conn.execute("SELECT COUNT(*) FROM awards WHERE title_en LIKE '%Ferreira%'").fetchone()[0] == 2

    # Tonight's file holds only the newest version, and the supplier now reads as a person.
    stats = canadabuys.load_file(conn, "awards", write_csv(tmp_path / "b.csv", header, [v1]), "fy.csv", now=DAY2)
    versions = {r["amendment"]: dict(r) for r in conn.execute(
        "SELECT * FROM awards WHERE reference = 'cb-000-00000001'")}
    for amendment in (0, 1):
        row = versions[amendment]
        assert row["title_en"] == "TSPS SA (Task Based) - [name withheld]"
        assert row["title_fr"] == "SPTS AMA (en fonction des tâches) - [nom retiré]"
        assert row["description_en"] == "Task authorizations issued to [name withheld]."
        assert (row["supplier_raw"], row["organization_id"], row["supplier_withheld"]) == (None, None, 1)
    assert stats.excluded == 1 and stats.redacted == 6  # three fields on each version
    assert conn.execute("SELECT 1 FROM awards WHERE title_en LIKE '%Ferreira%' OR title_fr LIKE '%FERREIRA%' "
                        "OR description_en LIKE '%Ferreira%'").fetchone() is None


def test_a_contract_description_naming_its_withheld_vendor_is_redacted_before_it_is_cut(conn, fixtures, tmp_path):
    header, rows = read_csv(fixtures / "contracts_head.csv")
    for row in rows:
        if row["reference_number"] == "C-2020-2021-Q4-00013":
            row["description_en"] = "Accessibility audit by Laura Holloway"
            row["comments_fr"] = "Contrat avec Holloway, Laura"
            # The name straddles the 600-character cut: replaced first, so no part of it is left.
            row["comments_en"] = "x" * 590 + " Laura Holloway, consultant"
    stats = contracts.load_file(conn, write_csv(tmp_path / "c.csv", header, rows), now=DAY1)
    row = conn.execute("SELECT * FROM contracts WHERE reference = 'C-2020-2021-Q4-00013'").fetchone()
    assert row["description_en"] == "Accessibility audit by [name withheld]"
    assert row["comments_fr"] == "Contrat avec [nom retiré]"
    assert "Laura" not in row["comments_en"] and len(row["comments_en"]) == 600
    assert (stats.withheld, stats.redacted) == (1, 3)


def test_a_grant_title_naming_its_withheld_recipient_is_redacted(conn, fixtures, tmp_path):
    header, rows = read_csv(fixtures / "grants_head.csv")
    for row in rows:
        ref = row["ref_number"].strip()
        if ref == "199-2020-2021-Q4-CSGC17320680":  # Daniel Ashdale, operating as Ashdale Pottery: withheld
            row["agreement_title_en"] = "Daniel Ashdale - accessible studio (Ashdale Pottery)"
            row["agreement_title_fr"] = "Ashdale, Daniel - atelier accessible"
            row["prog_name_en"] = "Accessibility Fund: Daniel Ashdale"
        if ref == "199-2019-2020-Q4- CSGC16725277":  # a university whose operating name is a person's
            row["recipient_operating_name"] = "Laura Quentaro"
            row["agreement_title_en"] = "Research chair held by Laura Quentaro"
    stats = grants.load_file(conn, write_csv(tmp_path / "g.csv", header, rows), now=DAY1)
    withheld = conn.execute("SELECT * FROM grants WHERE reference = '199-2020-2021-Q4-CSGC17320680'").fetchone()
    assert withheld["title_en"] == "[name withheld] - accessible studio ([name withheld])"
    assert withheld["title_fr"] == "[nom retiré] - atelier accessible"
    assert withheld["program_en"] == "Accessibility Fund: [name withheld]"
    assert withheld["recipient_withheld"] == 1
    carleton = conn.execute("SELECT * FROM grants WHERE reference = '199-2019-2020-Q4- CSGC16725277'").fetchone()
    assert (carleton["legal_name"], carleton["operating_name"]) == ("Carleton University", None)
    assert carleton["title_en"] == "Research chair held by [name withheld]"
    assert stats.redacted == 5


def test_a_lobbying_subject_naming_its_withheld_client_is_redacted(seeded_conn, fixtures, tmp_path):
    files = {p.name: p.read_bytes() for p in sorted((fixtures / "lobbying").glob("*.csv"))}
    files["Communication_SubjectMattersExport.csv"] += b"500003,Licence for Daniel Ashdale's studio\r\n"
    path = tmp_path / "c.zip"
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    stats = lobbying.load_zip(seeded_conn, path, now=DAY1)
    row = seeded_conn.execute("SELECT client_raw, subject_matters FROM lobbying_communications "
                              "WHERE comm_number = '500003'").fetchone()
    assert row["client_raw"] is None
    assert json.loads(row["subject_matters"]) == ["Licence for [name withheld]'s studio"]
    assert stats.redacted == 1


def test_the_stages_log_how_many_names_they_replaced(conn, fixtures, tmp_path):
    header, rows = read_csv(fixtures / "contracts_head.csv")
    for row in rows:
        if row["reference_number"] == "C-2020-2021-Q4-00013":
            row["description_en"] = "Audit by Laura Holloway"
    samples = tmp_path / "s"
    samples.mkdir()
    write_csv(samples / "contracts-head.csv", header, rows)
    contracts.run(conn, None, now=DAY1, samples=samples)
    detail = conn.execute("SELECT detail FROM sources_log WHERE source = 'contracts'").fetchone()[0]
    assert detail.endswith("redacted=1") and "Holloway" not in detail

