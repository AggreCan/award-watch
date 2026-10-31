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
            assert e.find(f"{A}link[@rel='via']").get("href").startswith("https://canadabuys.canada.ca/en/tender-opportunities/")


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
    assert {(f["scope"], f["event"]) for f in index["feeds"]} == {("canada", "tenders"), ("canada", "awards")}


def test_national_feeds_are_written_even_when_empty(conn, tmp_path):
    counts, index = write(conn, tmp_path)
    assert counts["feeds"] == 2 and [f["entries"] for f in index["feeds"]] == [0, 0]
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
    assert slash.find(f"{A}link[@rel='via']").get("href").endswith("/tender-notice/ssc-26-00035339%3At")
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
