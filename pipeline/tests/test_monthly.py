"""The monthly record (monthly.py): which months it holds, which date puts a notice in a month, every figure of a
month held to rows written out here and counted by hand, the files' shapes and sizes, their determinism, the
sitemap's dates (a month whose figures a night left as they were keeps its date) and IndexNow's newest month."""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

import pytest

from awardwatch_pipeline import export_static as es
from awardwatch_pipeline import indexnow, indicators, monthly, organizations
from awardwatch_pipeline.db import connect, set_meta
from export_seed import STAMP, _buyer, award, tender

BASE = "https://awardwatch.example"
OPEN = ("Competitive - Open bidding", "Concurrentielle - Appel d'offres ouvert")
NON = ("Non-competitive", "Non concurrentielle")


def method(conn, ref, words):
    en, fr = words if words else (None, None)
    conn.execute("UPDATE tenders SET method_en = ?, method_fr = ? WHERE reference = ?", (en, fr, ref))


def world(conn):
    """Three buyers, a notice of each source long before the record (so both hold its months), and the notices of
    August, September and October 2026: every figure the tests below expect is counted from these rows."""
    _buyer(conn, "pwgsc-tpsgc", "Public Services and Procurement Canada", "Services publics et Approvisionnement Canada", "PSPC")
    _buyer(conn, "dnd-mdn", "National Defence", "Défense nationale", "DND")
    _buyer(conn, "hc-sc", "Health Canada", "Santé Canada", "HC")
    tender(conn, "T-OLD", 0, title="Old", published="2024-01-10", closing="2024-02-01T14:00:00", status="expired")
    award(conn, "A-OLD", 0, "Acme Defence Inc.", value=1_000.0, awarded="2024-01-05", published="2024-01-11")

    # Tender notices. September: T1 to T5. T6 was first published on August 31 (its amendment on September 2 does
    # not move it), T7 at 00:00 on October 1, T8 states no publication date.
    tender(conn, "T1", 0, title="One", published="2026-09-01", closing="2026-09-21T14:00:00", codes=("81111500",))
    tender(conn, "T2", 0, title="Two", published="2026-09-30", closing="2026-10-30T14:00:00", codes=("81111500", "72101500"))
    tender(conn, "T3", 0, title="Three", published="2026-09-30T23:59:00", closing=None, buyer="dnd-mdn", codes=())
    method(conn, "T3", NON)
    tender(conn, "T4", 0, title="Four", published="2026-09-15", closing="2026-09-10T14:00:00", buyer="hc-sc", codes=("43",))
    method(conn, "T4", None)
    tender(conn, "T5", 0, title="Five", published="2026-09-20", closing="2026-09-25T14:00:00", buyer=None, codes=("81",))
    tender(conn, "T6", 0, title="Six", published="2026-08-31", closing="2026-09-30T14:00:00", buyer="dnd-mdn")
    tender(conn, "T6", 1, title="Six, amended", published="2026-09-02", closing="2026-10-15T14:00:00", buyer="dnd-mdn")
    tender(conn, "T7", 0, title="Seven", published="2026-10-01T00:00:00", closing="2026-10-20T14:00:00")
    tender(conn, "T8", 0, title="Eight", published=None, closing="2026-10-20T14:00:00")

    # Award notices. September: A1 to A7 and A10. A8 is October's; A9 was first published on August 30.
    award(conn, "A1", 0, "Acme Defence Inc.", value=500_000.0, awarded="2026-08-20", published="2026-09-05")
    award(conn, "A2", 0, "Northern Translation Ltd", value=300_000.0, published="2026-09-30", buyer="dnd-mdn", competitive=0)
    award(conn, "A3", 0, "Beta Works Ltd", value=300_000.0, published="2026-09-10", buyer="dnd-mdn")
    award(conn, "A4", 0, None, value=50_000.0, published="2026-09-12", withheld=True, competitive=None)
    award(conn, "A5", 0, "Acme Defence Inc.", value=None, published="2026-09-15", competitive=0)
    award(conn, "A6", 0, "Overseas Optics GmbH", value=70_000.0, published="2026-09-16", currency="USD", country="DE", province="")
    award(conn, "A7", 0, "Gamma Supply Ltd", value=1_000.0, published="2026-09-18", buyer=None, status="cancelled")
    award(conn, "A8", 0, "Epsilon Ltd", value=5_000.0, published="2026-10-01")
    award(conn, "A9", 0, "Northern Translation Ltd", value=10_000.0, published="2026-08-30")
    award(conn, "A9", 1, "Northern Translation Ltd", value=12_000.0, published="2026-09-03")
    award(conn, "A10", 0, "Delta Corp", value=9_999_999.0, published="2026-09-20")
    conn.execute("INSERT INTO value_flags (kind, key, rule, computed_at) VALUES ('award', 'A10', 'total_vs_amount', ?)", (STAMP,))
    conn.commit()
    organizations.recompute(conn, now=STAMP)
    indicators.compute(conn, now=STAMP)
    conn.commit()


def build(conn, today):
    m = es.Model(conn, today)
    try:
        return m, monthly.build(m)
    finally:
        es.drop_temp(conn)


@pytest.fixture
def figures(conn):
    world(conn)
    _, (months, docs, index) = build(conn, date(2026, 10, 31))
    return conn, months, docs, index


# -- the months --------------------------------------------------------------------------------------------------------


def test_the_record_holds_the_last_twelve_complete_months_newest_first(figures):
    _, months, docs, index = figures
    # The data date is October 31: October is not over, so September is the newest month.
    assert months == ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01",
                      "2025-12", "2025-11", "2025-10"]
    assert [r["month"] for r in index["months"]] == months and set(docs) == set(months)


def test_a_month_is_complete_once_the_data_date_is_past_its_last_day(conn):
    world(conn)
    assert monthly.record_months(conn, "2026-10-31")[0] == "2026-09"
    assert monthly.record_months(conn, "2026-11-01")[0] == "2026-10"
    assert monthly.record_months(conn, "2026-11-30")[0] == "2026-10"


def test_a_source_holds_a_month_from_its_first_whole_month_and_its_first_notice(conn):
    _buyer(conn, "pwgsc-tpsgc", "Public Services and Procurement Canada", "Services publics", "PSPC")
    # Nothing read yet: no month is held, and the export writes an index with none.
    assert monthly.record_months(conn, "2026-11-01") == []
    # Award notices from 2012, tender notices from May 20, 2026: the months from June are held, May is not.
    award(conn, "A-2012", 0, "Acme Defence Inc.", value=1.0, published="2012-06-01")
    tender(conn, "T-MAY", 0, title="May", published="2026-05-20")
    assert monthly.record_months(conn, "2026-11-01") == ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06"]
    # The complete tender file starts on 2022-08-08 (HELD_FROM): a tender notice dated earlier holds no month before
    # September 2022, whatever the database holds.
    tender(conn, "T-2019", 0, title="Typed", published="2019-03-03")
    assert monthly.record_months(conn, "2023-01-15") == ["2022-12", "2022-11", "2022-10", "2022-09"]
    assert monthly.HELD_FROM == {"tenders": "2022-09", "awards": "2013-01"}
    assert monthly.add_months("2026-01", -1) == "2025-12" and monthly.add_months("2025-12", 13) == "2027-01"


# -- which date puts a notice in a month -----------------------------------------------------------------------------


def test_a_notice_is_in_the_month_of_its_first_publication_at_the_months_edges(conn):
    world(conn)
    _, (_, docs, _) = build(conn, date(2026, 11, 1))
    # September: T1 to T5, among them T2 and T3 published on its last day (T3 at 23:59). T6 is August's though its
    # amendment is September's. T7, at 00:00 on October 1, is October's. T8 is in no month.
    assert docs["2026-09"]["tenders"]["n"] == 5
    assert docs["2026-08"]["tenders"]["n"] == 1
    assert docs["2026-10"]["tenders"]["n"] == 1
    total = sum(d["tenders"]["n"] for d in docs.values())
    assert total == 7  # T1 to T7; T-OLD is before the record and T8 has no date
    # The award notices the same way: A9 (August 30, amended September 3) is August's, A8 October's.
    assert docs["2026-08"]["awards"]["n"] == 1 and docs["2026-10"]["awards"]["n"] == 1
    assert docs["2026-09"]["awards"]["n"] == 8


# -- the figures of a month, counted by hand ---------------------------------------------------------------------------


def test_the_tender_notices_of_a_month(figures):
    _, _, docs, _ = figures
    t = docs["2026-09"]["tenders"]
    assert t["n"] == 5
    # PSPC published T1 and T2; National Defence T3; Health Canada T4 (its page is not listed: no open notice and no
    # award, so the row names it without an id); T5 names no institution. The tie of one notice goes by id.
    assert t["buyers"] == [
        {"id": "pwgsc-tpsgc", "en": "Public Services and Procurement Canada", "fr": "Services publics et Approvisionnement Canada", "n": 2},
        {"id": "dnd-mdn", "en": "National Defence", "fr": "Défense nationale", "n": 1},
        {"id": None, "en": "Health Canada", "fr": "Santé Canada", "n": 1},
    ]
    assert t["n_no_buyer"] == 1
    # Segment 81: T1, T2, T5; 72: T2; 43: T4. T3 carries no code. Ties by code.
    assert t["segments"] == [{"code": "81", "n": 3}, {"code": "43", "n": 1}, {"code": "72", "n": 1}]
    assert t["n_no_segment"] == 1
    # Open bidding: T1, T2, T5; non-competitive: T3; T4 states none, last.
    assert t["methods"] == [{"en": OPEN[0], "fr": OPEN[1], "n": 3}, {"en": NON[0], "fr": NON[1], "n": 1}, {"en": None, "fr": None, "n": 1}]
    # Days open: T1 20, T2 30, T5 5; T3 states no closing, T4 closes before it was published. Median of 5, 20, 30.
    assert t["days_open"] == {"median": 20, "n": 3}
    assert t["before"] == {"month": "2026-08", "n": 1}
    assert t["year_before"] == {"month": "2025-09", "n": 0}


def test_the_award_notices_of_a_month(figures):
    conn, _, docs, _ = figures
    a = docs["2026-09"]["awards"]
    assert a["n"] == 8
    # Counted values: A1 500,000 + A2 300,000 + A3 300,000 + A4 50,000 + A7 0 (cancelled). A5 states none; A6 is in
    # US dollars and A10 flagged for checking: neither is counted.
    assert a["value"] == 1_150_000.0 and a["n_no_value"] == 1 and a["n_not_counted"] == 2
    # Non-competitive: A2 and A5; A4 states no method. Positive counted values: A1 to A4, of which A2 is non-competitive.
    assert (a["n_nc"], a["n_unstated"], a["pos"], a["pos_nc"]) == (2, 1, 1_150_000.0, 300_000.0)
    # The largest by counted value; A2 and A3 tie at 300,000 and go by reference. A10's 9,999,999 is flagged: not here.
    assert [(r["reference"], r["value"], r["published"]) for r in a["largest"]] == [
        ("A1", 500_000.0, "2026-09-05"), ("A2", 300_000.0, "2026-09-30"), ("A3", 300_000.0, "2026-09-10"),
        ("A4", 50_000.0, "2026-09-12"), ("A7", 0.0, "2026-09-18")]
    # The award lists' own row: A1 with its supplier's live id and name; A4's supplier withheld and named nowhere.
    first, withheld = a["largest"][0], a["largest"][3]
    assert first["organization"] == "Acme Defence Inc." and first["organization_id"].startswith("org-")
    assert first["awarded"] == "2026-08-20" and first["buyer_id"] == "pwgsc-tpsgc"
    assert withheld["organization"] is None and withheld["organization_id"] is None and withheld["supplier_withheld"] is True
    # Buyers by counted value: National Defence A2 + A3 = 600,000; PSPC A1 + A4 = 550,000 over five notices (A5 without
    # a value). A7 names no buyer.
    assert a["buyers"] == [
        {"id": "dnd-mdn", "en": "National Defence", "fr": "Défense nationale", "n": 2, "value": 600_000.0, "n_no_value": 0},
        {"id": "pwgsc-tpsgc", "en": "Public Services and Procurement Canada", "fr": "Services publics et Approvisionnement Canada",
         "n": 5, "value": 550_000.0, "n_no_value": 1},
    ]
    assert a["n_no_buyer"] == 1
    # Suppliers named: Acme (A1, A5), Northern, Beta, Overseas, Gamma, Delta; A4 names none. New in September: Beta,
    # Overseas, Gamma and Delta (Acme was named in 2024, Northern in August).
    assert (a["suppliers"], a["suppliers_new"]) == (6, 4)
    assert a["before"] == {"month": "2026-08", "n": 1, "value": 12_000.0, "n_no_value": 0}
    assert a["year_before"] == {"month": "2025-09", "n": 0, "value": None, "n_no_value": 0}


def test_a_month_with_no_notice(figures):
    _, _, docs, index = figures
    july = docs["2026-07"]
    assert july["tenders"] == {"n": 0, "buyers": [], "n_no_buyer": 0, "segments": [], "n_no_segment": 0, "methods": [],
                               "days_open": {"median": None, "n": 0}, "before": {"month": "2026-06", "n": 0},
                               "year_before": {"month": "2025-07", "n": 0}}
    a = july["awards"]
    assert (a["n"], a["value"], a["largest"], a["buyers"], a["suppliers"], a["pos"], a["pos_nc"]) == (0, None, [], [], 0, None, None)
    assert {"month": "2026-07", "tenders": 0, "awards": 0, "awards_value": None} in index["months"]


def test_a_comparison_month_the_data_do_not_hold_is_left_out(conn):
    world(conn)
    # The award notices now start on March 15, 2025, so they hold April 2025 on; the tender notices hold every month
    # from February 2024. The record's twelve months are held by both; a comparison a year back reaches March 2025 for
    # March 2026, which the award notices do not hold, and that comparison alone is left out.
    conn.execute("DELETE FROM awards WHERE reference = 'A-OLD'")
    award(conn, "A-FIRST", 0, "Acme Defence Inc.", value=1.0, published="2025-03-15")
    conn.commit()
    _, (months, docs, _) = build(conn, date(2026, 10, 31))
    assert len(months) == 12 and months[-1] == "2025-10"
    assert docs["2026-03"]["awards"]["year_before"] is None
    assert docs["2026-04"]["awards"]["year_before"] == {"month": "2025-04", "n": 0, "value": None, "n_no_value": 0}
    assert docs["2026-03"]["tenders"]["year_before"] == {"month": "2025-03", "n": 0}


# -- the files ---------------------------------------------------------------------------------------------------------


def export(conn, out, today):
    return es.export_static(conn, out, today=today, base_url=BASE)


def sitemap_pages(out):
    ns = {"sm": es.SITEMAP_NS}
    root = ET.parse(out / "sitemaps" / "sitemap-pages-1.xml").getroot()
    return {e.findtext("sm:loc", namespaces=ns).replace(BASE, ""): e.findtext("sm:lastmod", namespaces=ns)
            for e in root.findall("sm:url", ns)}


def test_the_export_writes_the_index_and_each_month_and_lists_them_in_the_sitemap(conn, tmp_path):
    world(conn)
    out = tmp_path / "static"
    counts = export(conn, out, date(2026, 10, 31))
    assert counts["monthly_months"] == 12
    index = json.loads((out / "monthly" / "index.json").read_text(encoding="utf-8"))
    assert index["as_of"] == "2026-10-31"
    assert index["months"][0] == {"month": "2026-09", "tenders": 5, "awards": 8, "awards_value": 1_150_000.0}
    files = sorted(p.name for p in (out / "monthly").iterdir())
    assert files == sorted(["index.json", *(f"{m['month']}.json" for m in index["months"])])
    # The data date is the file's only date of the run, at its top, where the sitemap's digest leaves it out.
    doc = (out / "monthly" / "2026-09.json").read_bytes()
    assert doc.startswith(b'{"as_of":"2026-10-31",') and doc.count(b"2026-10-31") == 1
    pages = sitemap_pages(out)
    assert pages["/monthly"] == "2026-10-31"
    assert [p for p in pages if p.startswith("/monthly/")] == [f"/monthly/{m['month']}" for m in index["months"]]


def test_the_export_is_deterministic_and_a_month_keeps_its_date_while_its_figures_stay(conn, tmp_path):
    world(conn)
    export(conn, tmp_path / "a", date(2026, 11, 1))
    export(conn, tmp_path / "b", date(2026, 11, 1))
    for name in ("index.json", "2026-10.json", "2026-09.json"):
        assert (tmp_path / "a" / "monthly" / name).read_bytes() == (tmp_path / "b" / "monthly" / name).read_bytes()
    first = sitemap_pages(tmp_path / "b")
    # The next night, nothing in the record changed: no month moves, nor the index.
    export(conn, tmp_path / "c", date(2026, 11, 2))
    second = sitemap_pages(tmp_path / "c")
    assert {p: second[p] for p in second if p.startswith("/monthly")} == {p: first[p] for p in first if p.startswith("/monthly")}
    assert second["/monthly/2026-09"] == "2026-11-01"
    # A late September notice arrives the night after: September moves, October too (it compares itself with
    # September) and the index; every other month keeps its date.
    award(conn, "A-LATE", 0, "Late Supply Ltd", value=2_000.0, published="2026-09-25", first_seen="2026-11-03")
    conn.commit()
    export(conn, tmp_path / "d", date(2026, 11, 3))
    third = sitemap_pages(tmp_path / "d")
    moved = {p for p in third if p.startswith("/monthly") and third[p] != second[p]}
    assert moved == {"/monthly", "/monthly/2026-09", "/monthly/2026-10"}
    assert all(third[p] == "2026-11-03" for p in moved)


def test_a_failing_monthly_section_is_logged_and_left_out_of_the_sitemap(conn, tmp_path, monkeypatch):
    world(conn)

    def broken(*args, **kwargs):
        raise RuntimeError("bad month")

    monkeypatch.setattr(monthly, "write_all", broken)
    out = tmp_path / "static"
    export(conn, out, date(2026, 10, 31))
    failed = conn.execute("SELECT source, detail FROM sources_log WHERE ok = 0").fetchall()
    assert [tuple(r) for r in failed] == [("export_monthly", "RuntimeError: bad month")]
    assert not (out / "monthly").exists()
    assert not any(p.startswith("/monthly") for p in sitemap_pages(out))


def test_an_empty_database_writes_an_index_with_no_month(tmp_path):
    conn = connect(memory=True)
    out = tmp_path / "static"
    export(conn, out, date(2026, 10, 31))
    assert json.loads((out / "monthly" / "index.json").read_text(encoding="utf-8")) == {"as_of": "2026-10-31", "months": []}
    assert [p.name for p in (out / "monthly").iterdir()] == ["index.json"]
    assert "/monthly" in sitemap_pages(out)


def test_files_stay_small_at_a_real_months_size(conn, tmp_path):
    """A month at the size of CanadaBuys' busiest: 3,000 tender notices from 120 buyers over 45 segments and seven
    methods, 1,500 award notices from 90 buyers to 900 suppliers, titles of 120 characters. The month's file holds
    ten rows a list, so it stays near its size whatever the month holds."""
    world(conn)
    for i in range(120):
        _buyer(conn, f"buyer-{i:03d}", f"Department of Example Affairs {i}", f"Ministère des affaires d'exemple {i}", f"DEA{i}")
    segments = sorted(es.read_segments())[:45]
    methods = [OPEN, NON, ("Competitive - Selective tendering", "Concurrentielle - Appel d'offres sélectif"),
               ("Competitive - Traditional", "Concurrentielle - Traditionnelle"), ("Advance contract award notice", "Préavis"),
               ("Competitive - Limited tendering", "Concurrentielle - Appel d'offres limité"), None]
    title = "Professional services for the review of a federal program, regional offices and headquarters, phase "
    for i in range(3_000):
        ref = f"cb-{i:04d}-30000000"
        tender(conn, ref, 0, title=f"{title}{i}"[:120], published=f"2026-09-{1 + i % 30:02d}", closing="2026-10-31T14:00:00",
               buyer=f"buyer-{i % 120:03d}", codes=(f"{segments[i % 45]}101500",))
        method(conn, ref, methods[i % 7])
    for i in range(1_500):
        award(conn, f"cb-{i:04d}-40000000", 0, f"Supplier Number {i % 900} Ltd", value=1_000.0 + i * 977.5,
              published=f"2026-09-{1 + i % 30:02d}", buyer=f"buyer-{i % 90:03d}", competitive=i % 4 and 1 or 0)
    conn.execute("UPDATE awards SET title_en = ? || reference, title_fr = ? || reference", (title[:100], title[:100]))
    conn.commit()
    organizations.recompute(conn, now=STAMP)
    out = tmp_path / "static"
    counts = export(conn, out, date(2026, 10, 31))
    month = (out / "monthly" / "2026-09.json").stat().st_size
    index = (out / "monthly" / "index.json").stat().st_size
    doc = json.loads((out / "monthly" / "2026-09.json").read_text(encoding="utf-8"))
    assert doc["tenders"]["n"] == 3_005 and doc["awards"]["n"] == 1_508
    assert len(doc["awards"]["largest"]) == len(doc["tenders"]["buyers"]) == len(doc["awards"]["buyers"]) == 10
    assert len(doc["tenders"]["segments"]) == 10 and len(doc["tenders"]["methods"]) == 7
    # Measured 2026-11-19: 10,774 bytes for the month, 806 for the index.
    assert month < 16_000 and index < 2_000, (month, index)
    assert counts["monthly_largest_bytes"] == month


def test_indexnow_sends_the_index_with_the_fixed_pages_and_then_the_newest_month(conn):
    world(conn)
    set_meta(conn, "data_as_of", "2026-11-02")
    conn.commit()
    urls = indexnow.changed_urls(conn, "2026-11-02T12:30:00Z", BASE)
    fixed = [BASE + p for p in indexnow.FIXED_PAGES]
    assert f"{BASE}/monthly" in fixed
    # No notice and no organization changed during this run: the fixed pages, then October, the newest month.
    assert urls == [*fixed, f"{BASE}/monthly/2026-10"]
    # A database that holds no month sends none.
    empty = connect(memory=True)
    set_meta(empty, "data_as_of", "2026-11-02")
    assert not any("/monthly/" in u for u in indexnow.changed_urls(empty, "2026-11-02T12:30:00Z", BASE))


def test_the_site_reads_the_same_file_names_and_tables():
    """The site's loader (site/src/data.ts) reads monthly/index.json and monthly/<YYYY-MM>.json, and its page
    (site/src/pages/monthly.tsx) draws a CSV file for each table these files carry."""
    root = Path(__file__).resolve().parents[2] / "site" / "src"
    data = (root / "data.ts").read_text(encoding="utf-8")
    assert '"monthly/index.json"' in data and "`monthly/${month}.json`" in data
    page = (root / "pages" / "monthly.tsx").read_text(encoding="utf-8")
    assert 'export const MONTH_TABLES = ["tenders", "tenderbuyers", "segments", "methods", "awards", "competition", "largest", "awardbuyers"]' in page
    assert monthly.MONTHS == 12 and monthly.TOP == 10
