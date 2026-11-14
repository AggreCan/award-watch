"""The CSV downloads: the file names the site serves, SHA256SUMS, nothing private, and a stale year removed."""

import csv
import hashlib
import io
import re
from datetime import date

import pytest

from awardwatch_pipeline import export, indicators
from export_seed import (CONTACT_EMAIL, CONTACT_NAME, PERSON, PERSON_STREET, PROSE_EMAIL, SERVANT, SUPPLIER_STREET,
                         TODAY, seed, tender)


def rows(path):
    return list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig"))))


def test_the_downloads_and_their_sums(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    counts = export.run(conn, out, today=TODAY)
    names = sorted(p.name for p in out.iterdir())
    assert names == ["SHA256SUMS", "awards-2024.csv", "awards-2025.csv", "awards-2026.csv", "buyers.csv",
                     "contracts-2025.csv", "expiring-12m.csv", "expiring-3m.csv", "expiring-6m.csv", "grants-2026.csv",
                     "history-2026.csv", "open-tenders.csv", "organization-aliases.csv", "organizations.csv"]
    assert all(export.YEAR_RE.match(n) for n in names if n.startswith(("awards-", "history-", "contracts-", "grants-")))
    assert counts["open-tenders.csv"] == 4 and counts["awards-2026.csv"] == 4 and counts["organizations.csv"] == 3
    sums = (out / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
    assert len(sums) == len(names) - 1
    for line in sums:
        digest, name = line.split("  ")
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest
    assert not list(out.glob("*.partial"))
    log = conn.execute("SELECT source, rows_new FROM sources_log").fetchall()
    assert [tuple(r) for r in log] == [("export_csv", 13)]


def test_the_3_month_file_is_the_12_month_file_cut_to_the_3_month_window(conn, tmp_path):
    """expiring-3m.csv, free on the site once the longer windows are part of the paid plan: the rows of
    expiring-12m.csv that end on or after the data date and within 91 days of it, same columns, same order."""
    seed(conn)
    out = tmp_path / "csv"
    counts = export.export_csv(conn, out, today=TODAY)
    twelve, three = rows(out / "expiring-12m.csv"), rows(out / "expiring-3m.csv")
    assert export.EXPIRING_3M_DAYS == 91
    assert list(three[0]) == list(twelve[0])
    assert [r["reference"] for r in three] == ["AW-5", "AW-2", "H-1"] and counts["expiring-3m.csv"] == 3
    assert three == [r for r in twelve if TODAY.isoformat() <= r["end"][:10] <= "2027-01-30"]
    # The edges: a contract ending 91 days after the data date is in, 92 days out; one that ended the day
    # before the data date is out. H-1 ends on 2027-01-20, AW-5 on 2026-11-30.
    edge = tmp_path / "edge"
    for today, kept in (("2026-10-21", True), ("2026-10-20", False)):
        export.export_csv(conn, edge, today=date.fromisoformat(today))
        assert ("H-1" in [r["reference"] for r in rows(edge / "expiring-3m.csv")]) is kept, today
    export.export_csv(conn, edge, today=date(2026, 12, 1))
    refs = [r["reference"] for r in rows(edge / "expiring-3m.csv")]
    assert "AW-5" not in refs and refs[:2] == ["AW-2", "H-1"]


def test_the_6_month_file_is_the_12_month_file_cut_to_the_6_month_window(conn, tmp_path):
    """expiring-6m.csv, part of the paid plan with the 12-month file: the rows of expiring-12m.csv that end on or
    after the data date and within 182 days of it, same columns, same order, between the 3-month file and the
    12-month one."""
    seed(conn)
    out = tmp_path / "csv"
    counts = export.export_csv(conn, out, today=TODAY)
    twelve, six, three = rows(out / "expiring-12m.csv"), rows(out / "expiring-6m.csv"), rows(out / "expiring-3m.csv")
    assert export.EXPIRING_6M_DAYS == 182 and set(export.EXPIRING_WINDOW_FILES) == {"expiring-3m.csv", "expiring-6m.csv"}
    assert list(six[0]) == list(twelve[0])
    assert [r["reference"] for r in six] == ["AW-5", "AW-2", "H-1", "23240-220799/001/IM", "dnd-mdn:C-2"]
    assert counts["expiring-6m.csv"] == 5
    assert six == [r for r in twelve if TODAY.isoformat() <= r["end"][:10] <= "2027-05-01"]
    assert six[:len(three)] == three and len(three) < len(six) < len(twelve)
    # The edges: dnd-mdn:C-2 ends on 2027-03-31, 182 days after 2026-09-30 and 183 after 2026-09-29.
    edge = tmp_path / "edge"
    for today, kept in (("2026-09-30", True), ("2026-09-29", False)):
        export.export_csv(conn, edge, today=date.fromisoformat(today))
        assert ("dnd-mdn:C-2" in [r["reference"] for r in rows(edge / "expiring-6m.csv")]) is kept, today
    # Listed in SHA256SUMS like every other file.
    assert any(line.endswith("  expiring-6m.csv") for line in (out / "SHA256SUMS").read_text(encoding="utf-8").splitlines())


def test_nothing_private_goes_in_a_file(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    text = "".join(p.read_text(encoding="utf-8") for p in out.glob("*.csv"))
    for secret in (PERSON, PERSON_STREET, CONTACT_NAME, CONTACT_EMAIL, SERVANT, SUPPLIER_STREET):
        assert secret not in text
    withheld = next(r for r in rows(out / "awards-2026.csv") if r["reference"] == "AW-5")
    assert withheld["supplier"] == "" and withheld["supplier_withheld"] == "1" and withheld["organization_id"] == ""
    header = (out / "open-tenders.csv").read_text(encoding="utf-8-sig").splitlines()[0]
    assert "contact" not in header and header.startswith("reference,amendment,")


def test_a_year_with_no_rows_left_is_removed_and_files_are_rewritten_whole(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    before = (out / "buyers.csv").read_bytes()
    conn.execute("UPDATE awards SET awarded = '2026-01-01', published = '2026-01-02' WHERE awarded LIKE '2024%'")
    export.export_csv(conn, out)
    assert not (out / "awards-2024.csv").exists()
    assert "awards-2024.csv" not in (out / "SHA256SUMS").read_text(encoding="utf-8")
    assert (out / "buyers.csv").read_bytes() == before


@pytest.mark.parametrize("text", [
    "Questions to generic.inbox@tpsgc-pwgsc.gc.ca.",
    "Questions to someone @ tpsgc-pwgsc.gc.ca", "Write to someone@ministry",
    "Call 613-555-0142", "Call (819) 555 0123", "Call +1 819 555 0123", "Call +1 (819) 555-0124 ext. 12",
    "Fax: 6135550199", "Toll free 1-800-555-0100", "Tel. 613.555.0199 poste 2345",
])
def test_the_scrub_takes_every_address_and_number_form(text):
    for lang, mark in (("en", "[contact removed]"), ("fr", "[coordonnées retirées]")):
        out = export.scrub(text, lang)
        assert mark in out and "@" not in out and not re.search(r"\d{7,}", out.replace("-", "").replace(" ", "")), out


@pytest.mark.parametrize("phone", [
    "613-555-0100", "(613) 555-0100", "613.555.0100", "613 555 0100", "+1 613 555 0100", "1-800-555-0100",
    "613-555-0100 ext. 123", "(613) 555-0100, ext 4", "+1-613-555-0100", "(613)555-0100 x22", "613 555-0100 poste 2345",
])
def test_the_scrub_takes_a_telephone_number_in_every_written_form(phone):
    for text in (phone, f"Call {phone} before noon.", f"Tel: {phone}", f"Phone: {phone}Courriel : x"):
        out = export.scrub(text)
        assert "[contact removed]" in out and not re.search(r"\d{3}\D{0,2}\d{4}", out), (text, out)
    assert export.scrub(f"Téléphone : {phone}", "fr") == "Téléphone : [coordonnées retirées]"


@pytest.mark.parametrize("text", [
    "Snow removal, 2026-10-31 to 2027-03-31", "Value $1,234,567.89", "Contract W8486-123456/001/XX",
    "Item 12345678 qty 100", "Postal code K1A 0B1",
    # What the scrub of 2026-10-30 took from titles and descriptions as contact details.
    "RFI W8476226540A Deployable Camp Infrastructure and Utilities",
    "at the following coordinates: 49.060149403918174, -125.72271370346736. The site",
    "49.0601, -125.7227", "Bids are due January 23 2026 @ 2:00PM EST. Failure to",
    "WS3779702227 (EN929-231320)", "ProServices SA – 1000309024 ONTARIO INC",
    "W8484-199273", "WS5176912673", "Doc5303974397", "EN929-231320", "Number 12345678901234",
    "Part No.: 400-013-4490-41, NCAGE: U1068", "closing at 14:00 EST, 2026-01-23", "2026-01-23 14:00:00",
    "See solicitation 5000075642R", "https://www.sac-isc.gc.ca/eng/1100100033057/1610797769658",
])
def test_the_scrub_leaves_references_coordinates_times_and_numbers_that_are_not_telephones(text):
    assert export.scrub(text) == text and export.scrub(text, "fr") == text


def test_csv_prose_is_scrubbed_in_its_own_language(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    text = "".join(p.read_text(encoding="utf-8") for p in out.glob("*.csv"))
    assert "@" not in text and PROSE_EMAIL not in text
    aw2 = next(r for r in rows(out / "awards-2026.csv") if r["reference"] == "AW-2")
    assert aw2["title_en"] == "Award AW-2"
    radar = rows(out / "expiring-12m.csv")
    assert [r["reference"] for r in radar][:2] == ["AW-5", "AW-2"] and radar[0]["supplier_withheld"] == "1"
    assert radar[0]["organization_id"] == "" and len(radar) == 6


def test_the_open_tenders_file_leaves_out_a_notice_past_its_closing_day(conn, tmp_path):
    """The open-notice file still lists notices that have closed; open-tenders.csv followed it."""
    seed(conn)
    tender(conn, "cb-yesterday", 0, title="Closed yesterday", closing="2026-10-30T14:00:00")
    tender(conn, "cb-today", 0, title="Closes today", closing="2026-10-31T14:00:00")
    tender(conn, "cb-tomorrow", 0, title="Closes tomorrow", closing="2026-11-01T09:00:00")
    conn.commit()
    out = tmp_path / "csv"
    counts = export.export_csv(conn, out, today=TODAY)
    refs = [r["reference"] for r in rows(out / "open-tenders.csv")]
    assert "cb-today" in refs and "cb-tomorrow" in refs and "cb-yesterday" not in refs
    assert counts["open-tenders.csv"] == 6 and all(r["status"] == "open" for r in rows(out / "open-tenders.csv"))


def test_buyers_csv_lists_only_buyers_with_records_and_never_a_person_spelling(conn, tmp_path):
    seed(conn)
    conn.execute("INSERT INTO buyers (id, name_en, updated_at) VALUES ('closed-only', 'Closed Only Agency', '2026-10-31')")
    tender(conn, "cb-closed", 0, title="Old", status="expired", closing="2026-01-10T14:00:00", buyer="closed-only")
    conn.execute("UPDATE awards SET buyer_id = NULL, buyer_raw_en = 'Aarondeep Maan' WHERE reference = 'AW-3'")
    conn.commit()
    indicators.compute(conn, now="2026-10-31T01:00:00Z")
    out = tmp_path / "csv"
    export.export_csv(conn, out, today=TODAY)
    assert [r["id"] for r in rows(out / "buyers.csv")] == ["dnd-mdn", "pwgsc-tpsgc"]
    aw3 = next(r for r in rows(out / "awards-2025.csv") if r["reference"] == "AW-3")
    assert aw3["buyer_id"] == "" and aw3["buyer_raw_en"] == ""
    assert "Aarondeep Maan" not in "".join(p.read_text(encoding="utf-8") for p in out.glob("*.csv"))
    # Another spelling stays as written.
    assert next(r for r in rows(out / "awards-2026.csv") if r["reference"] == "AW-2")["buyer_raw_en"] == "Raw buyer"


def test_the_alias_map_is_a_free_download_of_ids_and_nothing_else(conn, tmp_path):
    """The operator's ruling of 2026-11-07: the alias map (from_id, to_id, reason, note, since), chains followed to
    the live id as the site's redirects follow them, listed in SHA256SUMS and the Data page's list, no record data."""
    from awardwatch_pipeline import export_static

    ids = seed(conn)
    live = sorted(ids.values())[0]
    conn.executemany(
        "INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at, reason, note) VALUES (?, ?, ?, ?, ?, ?)",
        [("org-00000000a1", "org-00000000a2", 1, "2026-10-20T00:00:00Z", None, None),   # a normalization change...
         ("org-00000000a2", live, 2, "2026-11-02T00:00:00Z", "seed", "former"),          # ...then a seed merge
         ("org-00000000b1", live, 2, "2026-11-07T12:40:00Z", "spelling", None),
         ("org-00000000c1", "org-00000000ff", 2, "2026-11-07T12:40:00Z", "seed", None)])  # leads nowhere: left out
    out = tmp_path / "csv"
    counts = export.export_csv(conn, out, today=TODAY)
    assert counts[export.ALIASES_FILE] == 3
    got = rows(out / export.ALIASES_FILE)
    assert list(got[0]) == ["from_id", "to_id", "reason", "note", "since"]
    assert [tuple(r.values()) for r in got] == [
        ("org-00000000a1", live, "normalization", "", "2026-10-20"),
        ("org-00000000a2", live, "seed", "former", "2026-11-02"),
        ("org-00000000b1", live, "spelling", "", "2026-11-07")]
    # The same map as the redirects (aliases/<ab>.json).
    assert {r["from_id"]: r["to_id"] for r in got} == export_static.resolve_aliases(conn)
    assert (out / export.ALIASES_FILE).read_bytes().startswith(b"\xef\xbb\xbf")
    sums = (out / export.SUMS).read_text(encoding="utf-8")
    assert f"  {export.ALIASES_FILE}\n" in sums
    assert export.ALIASES_FILE in [d["file"] for d in export_static.download_files(out, counts)]
    # Ids, a reason, a note and a date: no name, place or value.
    text = (out / export.ALIASES_FILE).read_text(encoding="utf-8-sig")
    assert all(re.fullmatch(r"(org-[0-9a-f]{10},){2}[a-z_]+,[a-z]*,\d{4}-\d{2}-\d{2}", line)
               for line in text.splitlines()[1:])
