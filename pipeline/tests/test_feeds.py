"""Atom feeds of new tender and award notices: valid Atom, the scopes written and skipped, the
entries' text and links, a withheld supplier never named, and deterministic output."""

import json
import re
import xml.etree.ElementTree as ET
from datetime import date

from awardwatch_pipeline import export_static, feeds
from export_seed import PERSON, TODAY, _buyer, award, seed, tender

A = "{http://www.w3.org/2005/Atom}"
BASE = "https://awardwatch.example"


def write(conn, tmp_path, **kwargs):
    counts = feeds.write_feeds(conn, tmp_path, today=kwargs.pop("today", TODAY), base_url=BASE, **kwargs)
    index = json.loads((tmp_path / "feeds" / "index.json").read_text(encoding="utf-8"))
    return counts, index


def entries(tmp_path, rel):
    root = ET.parse(tmp_path / rel).getroot()
    return root, root.findall(f"{A}entry")


def test_every_feed_is_valid_atom_and_listed(conn, tmp_path):
    seed(conn)
    counts, index = write(conn, tmp_path)
    assert counts["feeds"] == len(index["feeds"]) and index["as_of"] == "2026-10-31" and index["max_entries"] == 50
    for item in index["feeds"]:
        root, rows = entries(tmp_path, item["path"])
        assert root.tag == f"{A}feed" and root.findtext(f"{A}id").startswith("tag:awardwatch.ca,2026:feeds/")
        assert len(rows) == item["entries"] and root.find(f"{A}link[@rel='self']").get("href") == f"{BASE}/data/{item['path']}"
        assert "Award Watch" in root.findtext(f"{A}title")
        for e in rows:
            assert e.findtext(f"{A}id").startswith("tag:awardwatch.ca,2026:")
            assert e.find(f"{A}link[@hreflang='fr']").get("href").endswith("?lang=fr")
            assert e.find(f"{A}link[@rel='via']").get("href").startswith((
                "https://canadabuys.canada.ca/en/tender-opportunities/", "https://open.canada.ca/data/en/dataset/",
                "https://search.open.canada.ca/contracts/"))


def test_scopes_written_and_their_paths(conn, tmp_path):
    seed(conn)
    _, index = write(conn, tmp_path)
    paths = {(f["scope"], f["key"], f["event"]): f for f in index["feeds"]}
    assert ("canada", "canada", "tenders") in paths and ("canada", "canada", "awards") in paths
    assert paths[("segment", "72", "tenders")]["path"] == "feeds/segment/72/tenders.xml"
    assert paths[("segment", "72", "awards")]["path"] == "feeds/segment/72/awards.xml"
    # Province feeds carry the upper-case code as their key and a lower-case folder; awards have none.
    assert paths[("prov", "BC", "tenders")]["path"] == "feeds/prov/bc/tenders.xml"
    assert not any(scope == "prov" and event == "awards" for scope, _, event in paths)
    buyer = paths[("buyer", "dnd-mdn", "tenders")]
    assert buyer["path"] == "feeds/buyer/dnd-mdn/tenders.xml" and buyer["name_en"] == "National Defence"
    assert buyer["name_fr"] == "Défense nationale" and buyer["updated"] == "2026-10-31"
    assert "name_en" not in paths[("segment", "72", "tenders")]


def test_a_scope_with_nothing_new_for_ninety_days_is_not_written(conn, tmp_path):
    seed(conn)
    _, index = write(conn, tmp_path, today=date(2027, 3, 1))
    assert {(f["scope"], f["event"]) for f in index["feeds"]} == {("canada", "tenders"), ("canada", "awards"),
                                                                  ("canada", "expiring")}


def test_national_feeds_are_written_even_when_empty(conn, tmp_path):
    counts, index = write(conn, tmp_path)
    assert counts["feeds"] == 3 and [f["entries"] for f in index["feeds"]] == [0, 0, 0]
    root, rows = entries(tmp_path, "feeds/canada/tenders.xml")
    assert rows == [] and root.findtext(f"{A}updated") == "2026-10-31T00:00:00Z"


def test_entries_name_the_notice_and_never_a_withheld_supplier(conn, tmp_path):
    seed(conn)
    write(conn, tmp_path)
    text = "".join(p.read_text(encoding="utf-8") for p in (tmp_path / "feeds").rglob("*.xml"))
    assert PERSON not in text
    _, rows = entries(tmp_path, "feeds/canada/awards.xml")
    by_id = {e.findtext(f"{A}id"): e for e in rows}
    withheld = by_id["tag:awardwatch.ca,2026:award/aw-5"]
    assert withheld.findtext(f"{A}summary").startswith("Supplier withheld.")
    named = by_id["tag:awardwatch.ca,2026:award/aw-2"]
    assert "Awarded to Northern Translation Ltd. Value $250,000.00" in named.findtext(f"{A}summary")
    assert "Valeur 250 000,00 $" in named.findtext(f"{A}summary")
    assert named.find(f"{A}link[@hreflang='en']").get("href") == f"{BASE}/awards/aw-2"
    _, tenders = entries(tmp_path, "feeds/canada/tenders.xml")
    slash = next(e for e in tenders if e.findtext(f"{A}id") == "tag:awardwatch.ca,2026:tender/ssc-26-00035339-t")
    assert slash.find(f"{A}link[@hreflang='en']").get("href") == f"{BASE}/tenders/ssc-26-00035339-t"
    # CanadaBuys serves the notice at its reference with the colon removed.
    assert slash.find(f"{A}link[@rel='via']").get("href").endswith("/tender-notice/ssc-26-00035339t")
    assert slash.findtext(f"{A}title") == "Network gear / Network gear (fr)"


def test_feeds_hold_the_newest_entries_up_to_the_cap(conn, tmp_path):
    _buyer(conn, "pwgsc-tpsgc", "PSPC", "SPAC", "PSPC")
    for i in range(5):
        tender(conn, f"cb-9-{i}", 0, title=f"Notice {i}", first_seen=f"2026-10-2{i}")
    award(conn, "AW-9", 0, "Cap Test Ltd", value=1.0)
    _, index = write(conn, tmp_path, max_entries=3)
    _, rows = entries(tmp_path, "feeds/canada/tenders.xml")
    assert [e.findtext(f"{A}id").rsplit("/", 1)[1] for e in rows] == ["cb-9-4", "cb-9-3", "cb-9-2"]
    assert index["max_entries"] == 3


def test_output_is_deterministic_and_names_no_other_site(conn, tmp_path):
    seed(conn)
    write(conn, tmp_path / "a")
    write(conn, tmp_path / "b")
    a = {p.relative_to(tmp_path / "a").as_posix(): p.read_bytes() for p in (tmp_path / "a").rglob("*") if p.is_file()}
    b = {p.relative_to(tmp_path / "b").as_posix(): p.read_bytes() for p in (tmp_path / "b").rglob("*") if p.is_file()}
    assert a == b
    blob = b"".join(a.values()).lower()
    # The only site a feed names is this one, and no prose carries an em-dash.
    assert set(re.findall(rb"[a-z]+watch\.ca", blob)) == {b"awardwatch.ca"}
    assert chr(0x2014).encode() not in blob


def test_helpers():
    assert feeds.rfc3339("2026-10-31") == "2026-10-31T00:00:00Z"
    assert feeds.rfc3339("2026-10-31T09:10:11-07:00") == "2026-10-31T16:10:11Z"
    assert feeds.rfc3339("soon") is None and feeds.rfc3339(None) is None
    assert feeds.fmt_money(1234.5, "CAD", "en") == "$1,234.50"
    assert feeds.fmt_money(1234.5, "EUR", "fr") == "1 234,50 EUR"
    assert feeds._clean("a\x00b\x1f") == "ab"
    assert feeds.TAG == "tag:awardwatch.ca,2026:" and feeds.SITE_NAME == "Award Watch"


def test_static_export_writes_the_feeds(conn, tmp_path):
    seed(conn)
    counts = export_static.export_static(conn, tmp_path / "static", today=TODAY, base_url=BASE)
    assert counts["feeds"] >= 2 and (tmp_path / "static" / "feeds" / "canada" / "awards.xml").exists()


def test_the_tenders_feed_leaves_out_a_notice_past_its_closing_day(conn, tmp_path):
    seed(conn)
    tender(conn, "cb-yesterday", 0, title="Closed yesterday", closing="2026-10-30T14:00:00")
    tender(conn, "cb-today", 0, title="Closes today", closing="2026-10-31T14:00:00")
    tender(conn, "cb-tomorrow", 0, title="Closes tomorrow", closing="2026-11-01T09:00:00")
    conn.commit()
    write(conn, tmp_path)
    _, rows = entries(tmp_path, "feeds/canada/tenders.xml")
    ids = {e.findtext(f"{A}id").rsplit("/", 1)[1] for e in rows}
    assert {"cb-today", "cb-tomorrow"} <= ids and "cb-yesterday" not in ids


def test_the_notice_address_on_canadabuys_drops_colons_and_keeps_slashes():
    """Checked against canadabuys.canada.ca and achatscanada.canada.ca on 2026-11-01: a colon reference is
    served with its colons removed (the escaped form, ssc-26-00035339%3at, answers 404); a slash
    reference keeps its slashes as path separators."""
    assert feeds.notice_path("SSC-26-00035339:T") == "ssc-26-00035339t"
    assert feeds.notice_path("SSC-26-00040563:A:1") == "ssc-26-00040563a1"
    assert feeds.notice_path("W2585-220001:004:WPG") == "w2585-220001004wpg"
    assert feeds.notice_path("01044-221065/001/PI") == "01044-221065/001/pi"
    assert feeds.notice_path("W8484-210010/001/PI") == "w8484-210010/001/pi"
    assert feeds.notice_path("EE520-221500/001/QCM") == "ee520-221500/001/qcm"
    assert feeds.notice_path("cb-100-1") == "cb-100-1"


def test_a_tender_entry_prints_its_closing_time_in_eastern_time_and_the_feed_says_states_are_of_the_data_date(
        conn, tmp_path):
    """CanadaBuys publishes closing times in Eastern time with no zone in its file; the summary names the zone
    as the site does, and the description says the closing states are those of the data date."""
    seed(conn)
    tender(conn, "cb-zone-none", 0, title="No zone", closing="2026-11-04T14:00:00")
    tender(conn, "cb-zone-given", 0, title="Zone given", closing="2026-11-04T14:00:00-08:00")
    conn.commit()
    write(conn, tmp_path)
    root, rows = entries(tmp_path, "feeds/canada/tenders.xml")
    summary = {e.findtext(f"{A}id").rsplit("/", 1)[1]: e.findtext(f"{A}summary") for e in rows}
    assert "Closing 2026-11-04 14:00 ET." in summary["cb-zone-none"]
    assert "Clôture le 2026-11-04 14 h 00 HE." in summary["cb-zone-none"]
    assert "Closing 2026-11-04 14:00 -08:00." in summary["cb-zone-given"]
    assert "Closing states are as of the data date" in root.findtext(f"{A}subtitle")
    assert "Les états de clôture sont ceux de la date des données" in root.findtext(f"{A}subtitle")
    assert feeds.closing_text("2026-11-04", "en") == "2026-11-04"
    assert feeds.closing_text("2026-11-04T14:00:00Z", "fr") == "2026-11-04 14 h 00 UTC"


def test_a_night_past_the_first_page_continues_in_linked_pages(conn, tmp_path, monkeypatch):
    """RFC 5005 paged feeds: the first file holds the newest MAX_ENTRIES; the rest of the newest night follow
    in <event>-2.xml and on, linked next, previous, first and last; an older night is not paged."""
    seed(conn)
    for i in range(7):
        tender(conn, f"cb-night-{i}", 0, title=f"Tonight {i}", closing="2026-11-20T14:00:00")
    for i in range(3):
        tender(conn, f"cb-before-{i}", 0, title=f"Last week {i}", closing="2026-11-20T14:00:00", first_seen="2026-10-24")
    conn.commit()
    counts, index = write(conn, tmp_path, max_entries=3)
    item = next(f for f in index["feeds"] if f["scope"] == "canada" and f["event"] == "tenders")
    tonight = 7
    assert item["entries"] == 3 and item["pages"] >= 3
    root1, first = entries(tmp_path, "feeds/canada/tenders.xml")
    assert root1.find(f"{A}link[@rel='next']").get("href") == f"{BASE}/data/feeds/canada/tenders-2.xml"
    assert root1.find(f"{A}link[@rel='previous']") is None
    last = item["pages"]
    root_last, rows_last = entries(tmp_path, f"feeds/canada/tenders-{last}.xml")
    assert root_last.find(f"{A}link[@rel='next']") is None
    assert root_last.find(f"{A}link[@rel='previous']").get("href").endswith(f"tenders-{last - 1}.xml" if last > 2 else "tenders.xml")
    assert root_last.find(f"{A}link[@rel='first']").get("href") == f"{BASE}/data/feeds/canada/tenders.xml"
    # Every entry of the night is on some page, each once; last week's are not paged.
    ids = []
    for n in range(1, last + 1):
        _, rows = entries(tmp_path, "feeds/canada/tenders.xml" if n == 1 else f"feeds/canada/tenders-{n}.xml")
        ids += [e.findtext(f"{A}id").rsplit("/", 1)[1] for e in rows]
    assert len(ids) == len(set(ids))
    assert {f"cb-night-{i}" for i in range(tonight)} <= set(ids)
    assert not {f"cb-before-{i}" for i in range(3)} & set(ids)
    assert counts["feed_files"] > counts["feeds"]
    assert not (tmp_path / "feeds" / "canada" / f"tenders-{last + 1}.xml").exists()


def test_feed_pages_stop_at_the_newest_night_and_the_page_cap():
    def e(day, i):
        return feeds.Entry(id=str(i), updated=f"{day}T00:00:00Z", title="t", summary="s", link="/", via="v")
    night = [e("2026-10-31", i) for i in range(12)] + [e("2026-10-30", 100 + i) for i in range(5)]
    pages = feeds.feed_pages(night, max_entries=5, max_pages=20)
    assert [len(p) for p in pages] == [5, 5, 2]
    assert [len(p) for p in feeds.feed_pages(night, max_entries=5, max_pages=2)] == [5, 5]
    assert feeds.feed_pages([], max_entries=5) == [[]]
    # A short night fills the first page with older entries and has no second.
    assert [len(p) for p in feeds.feed_pages(night[10:], max_entries=5)] == [5]
