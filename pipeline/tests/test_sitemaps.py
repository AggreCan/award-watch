"""Sitemaps: the fixed pages, then every organization, buyer, category, open and recent tender, award year
and directory page, at most 50,000 to a file, with an index of the parts at the site root."""

import xml.etree.ElementTree as ET

from awardwatch_pipeline import export_static as es
from export_seed import COLON_REF, TODAY, seed

NS = {"sm": es.SITEMAP_NS}
BASE = "https://awardwatch.example"


def parse(path):
    return ET.parse(path).getroot()  # raises on malformed XML


def locs(root, tag):
    return [(e.findtext("sm:loc", namespaces=NS), e.findtext("sm:lastmod", namespaces=NS))
            for e in root.findall(f"sm:{tag}", NS)]


def test_parts_respect_the_limit_and_the_index_lists_them(tmp_path):
    entries = [("/", "2026-10-12"), ("/methodology", None), ("/organizations/org-0000000001", "2026-10-15"),
               ("/tenders/a&b", "2026-10-11"), ("/buyers/dnd-mdn", None)]
    counts = es.write_sitemaps(entries, tmp_path, BASE + "/", max_urls=2)
    assert counts == {"sitemap_files": 3, "sitemap_urls": 5}
    parts = [locs(parse(tmp_path / "sitemaps" / f"sitemap-{n}.xml"), "url") for n in (1, 2, 3)]
    assert [len(p) for p in parts] == [2, 2, 1]
    assert parts[0] == [(f"{BASE}/", "2026-10-12"), (f"{BASE}/methodology", None)]
    # XML special characters are escaped and parse back.
    assert parts[1][1] == (f"{BASE}/tenders/a&b", "2026-10-11")
    index = parse(tmp_path / "sitemaps" / "index.xml")
    assert index.tag == f"{{{es.SITEMAP_NS}}}sitemapindex"
    # Parts are named at the site root, where the Worker serves them, with the newest date inside each.
    assert locs(index, "sitemap") == [(f"{BASE}/sitemap-1.xml", "2026-10-12"), (f"{BASE}/sitemap-2.xml", "2026-10-15"),
                                      (f"{BASE}/sitemap-3.xml", None)]


def test_full_size_split():
    entries = list(range(168_000))
    assert [len(c) for c in es.sitemap_chunks(entries)] == [50_000, 50_000, 50_000, 18_000]
    assert es.sitemap_chunks(list(range(50_000))) == [list(range(50_000))]


def test_lastmod_accepts_dates_only():
    assert es._lastmod("2026-10-12T09:10:00Z") == "2026-10-12"
    assert es._lastmod("2026-10-12") == "2026-10-12"
    assert es._lastmod(None) is None and es._lastmod("") is None and es._lastmod("pending") is None


def test_static_export_writes_the_sitemaps(conn, tmp_path):
    ids = seed(conn)
    out = tmp_path / "static"
    counts = es.export_static(conn, out, today=TODAY, base_url=BASE)
    part = parse(out / "sitemaps" / "sitemap-1.xml")
    entries = dict(locs(part, "url"))
    urls = [u for u, _ in locs(part, "url")]
    assert counts["sitemap_files"] == 1 and counts["sitemap_urls"] == len(urls) == len(set(urls))
    assert urls[:len(es.SITEMAP_PAGES)] == [BASE + p for p in es.SITEMAP_PAGES]
    assert entries[f"{BASE}/"] == "2026-10-31" and entries[f"{BASE}/methodology"] is None
    # The alerts page changes with the code only, so it carries no date.
    assert entries[f"{BASE}/alerts"] is None
    for oid in ids.values():
        assert entries[f"{BASE}/organizations/{oid}"] == "2026-10-31"
    # Buyers some record names; the one with none has no page.
    assert f"{BASE}/buyers/dnd-mdn" in entries and f"{BASE}/buyers/never-buys" not in entries
    assert sum(u.startswith(f"{BASE}/segments/") for u in urls) == 57
    # Open notices and notices first seen in the last 30 days, in lower case; an
    # expired notice first seen 30 days ago is neither.
    assert f"{BASE}/tenders/{es.url_reference(COLON_REF).lower()}" in entries
    assert f"{BASE}/tenders/cb-100-1" in entries and f"{BASE}/tenders/cb-400-4" not in entries
    assert f"{BASE}/awards/2026" in entries and f"{BASE}/awards/2029" not in entries
    assert f"{BASE}/organizations/directory/on" in entries
    assert all("?" not in u for u in urls)
    text = (out / "sitemaps" / "index.xml").read_text(encoding="utf-8")
    assert text.startswith('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex ')
    assert f"<loc>{BASE}/sitemap-1.xml</loc>" in text
