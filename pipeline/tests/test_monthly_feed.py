"""The monthly record's Atom feed (feeds.write_monthly_feed, written by monthly.write_all with the record's own files):
an entry a month in the page's own words, counted here by hand from test_monthly's rows; dates that move only when
a month's figures do and that equal the sitemap's; the faults that cost nothing else; the strings held to the site's
i18n.ts; and the Worker's fixture held to the writer's bytes (site/test/monthly-feed.test.ts holds that fixture's
titles and summaries to the site's own formatting, which covers the twelve month names and the numbers)."""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

from awardwatch_pipeline import export_static as es
from awardwatch_pipeline import feeds, monthly
from awardwatch_pipeline.db import connect
from export_seed import award
from test_monthly import BASE, sitemap_pages, world

A = "{http://www.w3.org/2005/Atom}"
SITE = Path(__file__).resolve().parents[2] / "site"
FEED = feeds.MONTHLY_FEED
NB = "\N{NO-BREAK SPACE}"
AP = "’"
RECORD = ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12",
          "2025-11", "2025-10"]


def export(conn, out, day):
    return es.export_static(conn, out, today=day, base_url=BASE)


def feed_of(out):
    root = ET.parse(out / FEED).getroot()
    return root, root.findall(f"{A}entry")


def entry_dates(out):
    """{a month's page address: the date its entry carries}."""
    return {e.find(f"{A}link[@hreflang='en']").get("href").replace(BASE, ""): e.findtext(f"{A}updated")[:10]
            for e in feed_of(out)[1]}


def failures(conn):
    return [tuple(r) for r in conn.execute("SELECT source, detail FROM sources_log WHERE ok = 0")]


def blocks(data):
    """A feed file's entries as written, in order."""
    return re.findall(rb"<entry>.*?</entry>", data, re.S)


# -- the entries -------------------------------------------------------------------------------------------------------


def test_an_entry_for_each_month_the_record_holds_newest_first_in_the_pages_words(conn, tmp_path):
    world(conn)
    out = tmp_path / "static"
    counts = export(conn, out, date(2026, 10, 31))
    root, entries = feed_of(out)
    assert counts["monthly_feed_entries"] == 12
    assert [e.findtext(f"{A}id") for e in entries] == [f"tag:awardwatch.ca,2026:monthly/{m}" for m in RECORD]
    sept, aug, july = entries[:3]
    assert sept.findtext(f"{A}title") == "Federal Procurement in September 2026 / Marchés publics fédéraux en septembre 2026"
    assert entries[-1].findtext(f"{A}title") == "Federal Procurement in October 2025 / Marchés publics fédéraux en octobre 2025"
    # September (test_monthly's rows): T1 to T5 published; A1 to A7 and A10 published, counted 500,000 + 300,000 +
    # 300,000 + 50,000 + 0 (A7 cancelled); A5 states no value, A6 is in US dollars and A10 flagged.
    assert sept.findtext(f"{A}summary") == (
        "In September 2026, federal buyers published 5 tender notices and 8 award notices on CanadaBuys; the award "
        f"notices state $1,150,000 in Canadian dollars in total. / En septembre 2026, les acheteurs fédéraux ont publié "
        f"5 avis d{AP}appel d{AP}offres et 8 avis d{AP}attribution sur AchatsCanada; les avis d{AP}attribution indiquent "
        f"1{NB}150{NB}000{NB}$ en dollars canadiens au total.")
    # August: T6 (first published August 31) and A9 (August 30; 12,000 at its newest version), one of each.
    assert aug.findtext(f"{A}summary") == (
        "In August 2026, federal buyers published 1 tender notice and 1 award notice on CanadaBuys; the award notices "
        f"state $12,000 in Canadian dollars in total. / En août 2026, les acheteurs fédéraux ont publié 1 avis "
        f"d{AP}appel d{AP}offres et 1 avis d{AP}attribution sur AchatsCanada; les avis d{AP}attribution indiquent "
        f"12{NB}000{NB}$ en dollars canadiens au total.")
    # July: no notice of either kind, so no value: the page's first sentence alone.
    assert july.findtext(f"{A}summary") == (
        "In July 2026, federal buyers published no tender notice and no award notice on CanadaBuys. / En juillet 2026, "
        f"les acheteurs fédéraux ont publié aucun avis d{AP}appel d{AP}offres et aucun avis d{AP}attribution sur "
        "AchatsCanada.")
    assert sept.find(f"{A}link[@hreflang='en']").get("href") == f"{BASE}/monthly/2026-09"
    assert sept.find(f"{A}link[@hreflang='fr']").get("href") == f"{BASE}/monthly/2026-09?lang=fr"
    assert sept.find(f"{A}link[@rel='via']") is None
    # The feed itself, shaped as every other feed: the first night dates every month, and the feed, with its date.
    assert root.findtext(f"{A}id") == "tag:awardwatch.ca,2026:feeds/canada/monthly"
    assert root.findtext(f"{A}title") == ("Award Watch: Monthly record of federal procurement, Canada / Bilan mensuel "
                                          "des marchés publics fédéraux, Canada")
    assert root.findtext(f"{A}updated") == "2026-10-31T00:00:00Z"
    assert all(e.findtext(f"{A}updated") == "2026-10-31T00:00:00Z" for e in entries)
    assert root.find(f"{A}link[@rel='self']").get("href") == f"{BASE}/data/feeds/canada/monthly.xml"
    assert root.find(f"{A}link[@rel='alternate']").get("href") == f"{BASE}/monthly"
    assert root.find(f"{A}link[@rel='related']").get("href") == f"{BASE}/feeds"
    assert root.findtext(f"{A}author/{A}name") == "Award Watch" and root.findtext(f"{A}rights") == " / ".join(feeds.RIGHTS)
    assert FEED == feeds.page_path(feeds.CANADA, feeds.MONTHLY_EVENT, 1) == "feeds/canada/monthly.xml"
    # The monthly index names it; the feeds section's index does not (it was written before).
    assert json.loads((out / "monthly" / "index.json").read_bytes())["feed"] == FEED
    assert not any("monthly" in f["path"] for f in json.loads((out / "feeds" / "index.json").read_bytes())["feeds"])
    # Nothing in it is the night of the run but the dates the ledger gave.
    assert (out / FEED).read_bytes().count(b"2026-10-31") == 13


# -- dates that do not move ----------------------------------------------------------------------------------------------


def test_two_nights_without_a_change_keep_the_bytes_and_a_third_moves_only_its_month(conn, tmp_path):
    world(conn)
    export(conn, tmp_path / "one", date(2026, 11, 1))
    export(conn, tmp_path / "two", date(2026, 11, 2))
    second = (tmp_path / "two" / FEED).read_bytes()
    assert second == (tmp_path / "one" / FEED).read_bytes()
    assert set(entry_dates(tmp_path / "two").values()) == {"2026-11-01"}
    # A late October award notice arrives on the third night (October has T7, and A8 at 5,000): October's figures
    # move, and no other month's (October is the newest month; nothing compares itself with it).
    award(conn, "A-LATE", 0, "Late Supply Ltd", value=2_000.0, published="2026-10-20", first_seen="2026-11-03")
    conn.commit()
    export(conn, tmp_path / "three", date(2026, 11, 3))
    third = (tmp_path / "three" / FEED).read_bytes()
    root, entries = feed_of(tmp_path / "three")
    october = entries[0]
    assert october.findtext(f"{A}id") == "tag:awardwatch.ca,2026:monthly/2026-10"
    assert october.findtext(f"{A}updated") == "2026-11-03T00:00:00Z" and root.findtext(f"{A}updated") == "2026-11-03T00:00:00Z"
    assert october.findtext(f"{A}summary") == (
        "In October 2026, federal buyers published 1 tender notice and 2 award notices on CanadaBuys; the award notices "
        f"state $7,000 in Canadian dollars in total. / En octobre 2026, les acheteurs fédéraux ont publié 1 avis "
        f"d{AP}appel d{AP}offres et 2 avis d{AP}attribution sur AchatsCanada; les avis d{AP}attribution indiquent "
        f"7{NB}000{NB}$ en dollars canadiens au total.")
    # Every other byte is the second night's: the feed's date and October's entry are all that moved.
    assert blocks(third)[1:] == blocks(second)[1:]
    assert len(blocks(third)) == 12
    old_october = blocks(second)[0]
    assert b"<updated>2026-11-01T00:00:00Z</updated>" in old_october
    put_back = third.replace(blocks(third)[0], old_october).replace(
        b"  <updated>2026-11-03T00:00:00Z</updated>\n  <link rel=\"self\"", b"  <updated>2026-11-01T00:00:00Z</updated>\n  <link rel=\"self\"")
    assert put_back == second


def test_the_feed_and_the_sitemap_give_each_month_the_same_date(conn, tmp_path):
    world(conn)
    nights = []
    for n, day in enumerate((date(2026, 11, 1), date(2026, 11, 2), date(2026, 11, 3), date(2026, 11, 4))):
        if n == 2:
            # A late September notice: September moves, and October, which compares itself with September.
            award(conn, "A-LATE", 0, "Late Supply Ltd", value=2_000.0, published="2026-09-25", first_seen="2026-11-03")
            conn.commit()
        out = tmp_path / str(n)
        export(conn, out, day)
        dated = entry_dates(out)
        assert dated == {p: d for p, d in sitemap_pages(out).items() if p.startswith("/monthly/")}, day
        assert feed_of(out)[0].findtext(f"{A}updated")[:10] == max(dated.values())
        nights.append(dated)
    assert nights[1] == nights[0]
    assert {p for p in nights[2] if nights[2][p] != nights[1][p]} == {"/monthly/2026-09", "/monthly/2026-10"}
    assert nights[2]["/monthly/2026-09"] == "2026-11-03" and nights[2]["/monthly/2026-08"] == "2026-11-01"
    assert nights[3] == nights[2]


# -- faults ------------------------------------------------------------------------------------------------------------


def other_sections_stand(out):
    for rel in ("feeds/index.json", "feeds/canada/tenders.xml", "feeds/canada/awards.xml", "buyers/index.json",
                "categories/index.json", "rankings/all.json", "expiring/index.json", "directory/index.json",
                "instruments/index.json", "stats.json"):
        assert (out / rel).is_file(), rel


def test_a_fault_in_the_feed_costs_no_other_file(conn, tmp_path, monkeypatch):
    world(conn)

    def broken(out, months, dates, **kwargs):
        # Part of a file, then the fault: what it left is removed.
        (out / FEED).parent.mkdir(parents=True, exist_ok=True)
        (out / FEED).write_bytes(b"<?xml")
        raise RuntimeError("bad feed")

    monkeypatch.setattr(feeds, "write_monthly_feed", broken)
    out = tmp_path / "static"
    counts = export(conn, out, date(2026, 10, 31))
    assert failures(conn) == [("export_monthly_feed", "RuntimeError: bad feed")]
    assert not (out / FEED).exists() and "monthly_feed_entries" not in counts
    # The record stands without it, and its index names no feed.
    index = json.loads((out / "monthly" / "index.json").read_bytes())
    assert sorted(index) == ["as_of", "months"] and [r["month"] for r in index["months"]] == RECORD
    assert sorted(p.stem for p in (out / "monthly").glob("2*.json")) == sorted(RECORD)
    assert sum(p.startswith("/monthly/") for p in sitemap_pages(out)) == 12
    other_sections_stand(out)


def test_a_fault_in_the_monthly_section_writes_no_feed(conn, tmp_path, monkeypatch):
    world(conn)

    def broken(m):
        raise RuntimeError("bad month")

    monkeypatch.setattr(monthly, "build", broken)
    out = tmp_path / "static"
    export(conn, out, date(2026, 10, 31))
    assert failures(conn) == [("export_monthly", "RuntimeError: bad month")]
    assert not (out / "monthly").exists() and not (out / FEED).exists()
    other_sections_stand(out)


def test_a_fault_writing_the_index_takes_the_feed_away_with_it(conn, tmp_path, monkeypatch):
    world(conn)
    real = es._dump

    def dump(path, obj):
        if path.as_posix().endswith("monthly/index.json"):
            raise OSError("disk full")
        return real(path, obj)

    monkeypatch.setattr(es, "_dump", dump)
    out = tmp_path / "static"
    export(conn, out, date(2026, 10, 31))
    assert failures(conn) == [("export_monthly", "OSError: disk full")]
    assert not (out / FEED).exists() and not (out / "monthly" / "index.json").exists()
    assert not any(p.startswith("/monthly") for p in sitemap_pages(out))
    other_sections_stand(out)


def test_a_fault_in_the_feeds_section_leaves_the_monthly_feed(conn, tmp_path, monkeypatch):
    world(conn)

    def broken(*args, **kwargs):
        raise RuntimeError("bad feeds")

    monkeypatch.setattr(es, "write_feeds", broken)
    out = tmp_path / "static"
    export(conn, out, date(2026, 10, 31))
    assert failures(conn) == [("export_feeds", "RuntimeError: bad feeds")]
    assert not (out / "feeds" / "index.json").exists() and not (out / "feeds" / "canada" / "tenders.xml").exists()
    assert len(feed_of(out)[1]) == 12
    assert json.loads((out / "monthly" / "index.json").read_bytes())["feed"] == FEED


def test_the_feeds_page_is_dated_by_the_monthly_feed_coming_and_going(conn, tmp_path, monkeypatch):
    """/feeds lists the monthly feed while it is written, so its lastmod moves the night the feed goes and the night
    it comes back, and stays while nothing changes."""
    world(conn)
    dates = []
    for name, day in (("one", date(2026, 11, 1)), ("two", date(2026, 11, 2))):
        export(conn, tmp_path / name, day)
        dates.append(sitemap_pages(tmp_path / name)["/feeds"])

    def broken(*args, **kwargs):
        raise RuntimeError("bad feed")

    with monkeypatch.context() as patch:
        patch.setattr(feeds, "write_monthly_feed", broken)
        export(conn, tmp_path / "three", date(2026, 11, 3))
    dates.append(sitemap_pages(tmp_path / "three")["/feeds"])
    export(conn, tmp_path / "four", date(2026, 11, 4))
    dates.append(sitemap_pages(tmp_path / "four")["/feeds"])
    assert dates == ["2026-11-01", "2026-11-01", "2026-11-03", "2026-11-04"]
    # The feeds section's own index read the same on all four nights: the monthly feed alone moved the page.
    bodies = {json.dumps({k: v for k, v in json.loads((tmp_path / n / "feeds" / "index.json").read_bytes()).items()
                          if k != "as_of"}, sort_keys=True) for n in ("one", "two", "three", "four")}
    assert len(bodies) == 1


def test_a_record_with_no_month_has_no_feed(tmp_path):
    conn = connect(memory=True)
    out = tmp_path / "static"
    counts = export(conn, out, date(2026, 10, 31))
    assert not (out / FEED).exists() and "monthly_feed_entries" not in counts
    assert json.loads((out / "monthly" / "index.json").read_bytes()) == {"as_of": "2026-10-31", "months": []}
    assert feeds.write_monthly_feed(tmp_path / "bare", [], {}) == {} and not (tmp_path / "bare").exists()


# -- the site's words and formatting -------------------------------------------------------------------------------------


def test_the_feeds_words_are_the_sites():
    text = (SITE / "src" / "i18n.ts").read_text(encoding="utf-8")
    for key, pair in feeds.PAGE_STRINGS.items():
        m = re.search(rf'"{re.escape(key)}": \{{\s*en: ("(?:[^"\\\n]|\\.)*"),\s*fr: ("(?:[^"\\\n]|\\.)*"),?\s*\}}', text)
        assert m, key
        assert (json.loads(m[1]), json.loads(m[2])) == pair, key
    # The typography the site sets French in at read time, which fr_typography repeats: four replacements.
    body = text[text.index("export function frTypography"):]
    body = body[:body.index("\n}\n")]
    assert body.count(".replace(") == 4
    for part in (".replace(/'/g, \"’\")", '.replace(/ ([:%$»])/g, "\\u00a0$1")', '.replace(/« /g, "«\\u00a0")',
                 '.replace(/\\$ US/g, () => "$\\u00a0US")'):
        assert part in body, part
    assert feeds.fr_typography("l'avis : 5 % « oui » 3 $ US") == (
        f"l{AP}avis{NB}: 5{NB}% «{NB}oui{NB}» 3{NB}${NB}US")
    # The month's name is the page's: Intl's long month and numeric year, in UTC.
    page = (SITE / "src" / "pages" / "monthly.tsx").read_text(encoding="utf-8")
    assert '{ month: "long", year: "numeric", timeZone: "UTC" }' in page


def test_numbers_money_and_months_as_the_site_writes_them():
    """Each expected text is what Intl.NumberFormat and Intl.DateTimeFormat give in en-CA and fr-CA (fmtInt,
    fmtMoney and monthName on the site)."""
    assert feeds.int_text(1_234_567, "en") == "1,234,567" and feeds.int_text(1_234_567, "fr") == f"1{NB}234{NB}567"
    assert feeds.int_text(7, "fr") == "7"
    for value, en, fr in ((0.0, "$0", f"0{NB}$"), (512.5, "$512.50", f"512,50{NB}$"), (0.5, "$0.50", f"0,50{NB}$"),
                          (2.675, "$2.68", f"2,68{NB}$"), (999.995, "$1,000.00", f"1{NB}000,00{NB}$"),
                          (1_000.0, "$1,000", f"1{NB}000{NB}$"), (1_234.5, "$1,235", f"1{NB}235{NB}$"),
                          (98_765_432.1, "$98,765,432", f"98{NB}765{NB}432{NB}$"),
                          (2_500_000_000.99, "$2,500,000,001", f"2{NB}500{NB}000{NB}001{NB}$"),
                          (-1_234.5, "-$1,235", f"-1{NB}235{NB}$")):
        assert (feeds.money_text(value, "en"), feeds.money_text(value, "fr")) == (en, fr), value
    assert [feeds.month_name(f"2026-{n:02d}", "fr") for n in (2, 8, 12)] == ["février 2026", "août 2026", "décembre 2026"]
    assert feeds.month_name("2025-05", "en") == "May 2025"


# -- the Worker's fixture --------------------------------------------------------------------------------------------------


# The rows site/test/fixtures/feed-canada-monthly.xml was written from: the monthly index's three figures for twelve
# months (the first three are monthly-index.json's), each month's name once, and each form of the summary: none, one
# and many notices, a value with cents below $1,000, a half rounded away from zero, zero, none stated. The dates are
# each month's in the ledger; July's, the newest, is the feed's.
SITE_ROWS = [
    {"month": "2026-09", "tenders": 1234, "awards": 567, "awards_value": 98765432.1},
    {"month": "2026-08", "tenders": 40, "awards": 0, "awards_value": None},
    {"month": "2026-07", "tenders": 35, "awards": 5, "awards_value": 1000.0},
    {"month": "2026-06", "tenders": 1, "awards": 1, "awards_value": 512.5},
    {"month": "2026-05", "tenders": 0, "awards": 3, "awards_value": 0.0},
    {"month": "2026-04", "tenders": 2, "awards": 1, "awards_value": 2.675},
    {"month": "2026-03", "tenders": 1500, "awards": 820, "awards_value": 1234.5},
    {"month": "2026-02", "tenders": 980, "awards": 410, "awards_value": 2500000000.99},
    {"month": "2026-01", "tenders": 1100, "awards": 0, "awards_value": None},
    {"month": "2025-12", "tenders": 0, "awards": 0, "awards_value": None},
    {"month": "2025-11", "tenders": 1, "awards": 2, "awards_value": 999.995},
    {"month": "2025-10", "tenders": 12000, "awards": 7, "awards_value": 1150000.0},
]
SITE_DATES = {f"/monthly/{r['month']}": d for r, d in zip(SITE_ROWS, (
    "2026-10-01", "2026-09-01", "2026-10-31", "2026-07-01", "2026-06-01", "2026-05-01", "2026-04-01", "2026-03-01",
    "2026-02-01", "2026-01-01", "2025-12-01", "2025-11-01"))}


def test_the_workers_fixture_is_the_writers_bytes(tmp_path):
    """site/test/monthly-feed.test.ts serves site/test/fixtures/feed-canada-monthly.xml as the export's feed and
    holds its titles and summaries to the site's own words and formatting: written again here from its rows, it
    comes out byte for byte the same."""
    feeds.write_monthly_feed(tmp_path, SITE_ROWS, SITE_DATES, base_url="https://awardwatch.ca")
    assert (tmp_path / FEED).read_bytes() == (SITE / "test" / "fixtures" / "feed-canada-monthly.xml").read_bytes()
    index = json.loads((SITE / "test" / "fixtures" / "monthly-index.json").read_bytes())
    assert SITE_ROWS[:3] == index["months"] and index["feed"] == FEED
