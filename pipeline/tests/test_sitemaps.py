"""Sitemaps: the index names its parts in the order a search engine should read them (the open tender notices,
the site's own pages, the organizations with recent activity), each part at most 25,000 entries to a file (the
Worker serves each page twice, English and French, within the protocol's 50,000), and every lastmod is a date on
which the page really changed: a night that leaves a page as it was leaves its date as it was. An organization
with nothing recent is in no part: the site marks its profile noindex (site/src/seo.ts dormantProfile)."""

import re
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path

from awardwatch_pipeline import export_static as es
from awardwatch_pipeline import indicators, organizations
from export_seed import ACME, COLON_REF, FOREIGN, NORTH, PERSON, PERSON_STREET, TODAY, award, seed

NS = {"sm": es.SITEMAP_NS}
BASE = "https://awardwatch.example"
OLD = "Old Timers Ltd"


def parse(path):
    return ET.parse(path).getroot()  # raises on malformed XML


def locs(root, tag):
    return [(e.findtext("sm:loc", namespaces=NS), e.findtext("sm:lastmod", namespaces=NS))
            for e in root.findall(f"sm:{tag}", NS)]


def parts_of(out):
    """Each file the index names, in the index's order, with its entries."""
    index = locs(parse(out / "sitemaps" / "index.xml"), "sitemap")
    return [(loc.rsplit("/", 1)[1], mod, locs(parse(out / "sitemaps" / loc.rsplit("/", 1)[1]), "url")) for loc, mod in index]


def everything(out):
    """Every address any part lists, with its lastmod, and the index's own entries (each part's address)."""
    got = {}
    for name, mod, entries in parts_of(out):
        got[f"{BASE}/{name}"] = mod
        for loc, lastmod in entries:
            assert loc not in got, loc
            got[loc] = lastmod
    return got


def seed_with_an_old_supplier(conn):
    """The export seed plus one organization whose newest record is older than the active window."""
    ids = seed(conn)
    ids[OLD] = award(conn, "AW-OLD", 0, OLD, value=7_000.0, awarded="2021-05-05", published="2021-05-06")
    conn.commit()
    organizations.recompute(conn, now="2026-10-31T01:00:00Z")
    indicators.compute(conn, now="2026-10-31T01:00:00Z")
    conn.commit()
    return ids


def test_parts_respect_the_limit_and_the_index_lists_them_in_their_order(tmp_path):
    # The writer takes any named parts; "regions" stands for a part with entries after one with none.
    parts = [("open-tenders", [("/tenders/a&b", "2026-10-11")]),
             ("pages", [("/", "2026-10-12"), ("/methodology", None), ("/buyers/dnd-mdn", None)]),
             ("active-organizations", []),
             ("regions", [("/organizations/org-0000000001", "2026-10-15")])]
    counts = es.write_sitemaps(parts, tmp_path, BASE + "/", max_urls=2)
    assert counts == {"sitemap_files": 4, "sitemap_urls": 5, "sitemap_open_tenders": 1, "sitemap_pages": 3,
                      "sitemap_active_organizations": 0, "sitemap_regions": 1}
    files = sorted(p.name for p in (tmp_path / "sitemaps").iterdir())
    assert files == ["index.xml", "sitemap-open-tenders-1.xml", "sitemap-pages-1.xml", "sitemap-pages-2.xml",
                     "sitemap-regions-1.xml"]
    assert locs(parse(tmp_path / "sitemaps" / "sitemap-pages-1.xml"), "url") == [(f"{BASE}/", "2026-10-12"),
                                                                                (f"{BASE}/methodology", None)]
    # XML special characters are escaped and parse back.
    assert locs(parse(tmp_path / "sitemaps" / "sitemap-open-tenders-1.xml"), "url") == [(f"{BASE}/tenders/a&b", "2026-10-11")]
    index = parse(tmp_path / "sitemaps" / "index.xml")
    assert index.tag == f"{{{es.SITEMAP_NS}}}sitemapindex"
    # Parts are named at the site root, where the Worker serves them, in the parts' order; a part with no entry has
    # no file. Without the ledger, an index entry carries the newest date inside its file.
    assert locs(index, "sitemap") == [(f"{BASE}/sitemap-open-tenders-1.xml", "2026-10-11"),
                                      (f"{BASE}/sitemap-pages-1.xml", "2026-10-12"), (f"{BASE}/sitemap-pages-2.xml", None),
                                      (f"{BASE}/sitemap-regions-1.xml", "2026-10-15")]


def test_full_size_split():
    assert es.SITEMAP_MAX_URLS * 2 <= 50_000
    entries = list(range(68_000))
    assert [len(c) for c in es.sitemap_chunks(entries)] == [25_000, 25_000, 18_000]
    assert es.sitemap_chunks(list(range(25_000))) == [list(range(25_000))]


def test_lastmod_accepts_dates_only():
    assert es._lastmod("2026-10-12T09:10:00Z") == "2026-10-12"
    assert es._lastmod("2026-10-12") == "2026-10-12"
    assert es._lastmod(None) is None and es._lastmod("") is None and es._lastmod("pending") is None


def test_the_active_window_counts_back_whole_months():
    assert es.ACTIVE_MONTHS == 24
    assert es.active_since(date(2026, 10, 31)) == "2024-10-31"
    assert es.active_since(date(2026, 1, 15)) == "2024-01-15"
    # A day the earlier month lacks is that month's last day.
    assert es.active_since(date(2024, 2, 29)) == "2022-02-28"
    assert es.active_since(date(2026, 3, 31), months=1) == "2026-02-28"
    assert es.active_since(date(2026, 1, 10), months=1) == "2025-12-10"


def test_the_site_reads_the_same_window_for_its_noindex_rule():
    """site/src/seo.ts marks a profile noindex by the same count of months (its activeSince is this module's
    active_since, held to the same cases by site/test/seo-dormant.test.ts)."""
    source = (Path(__file__).resolve().parents[2] / "site" / "src" / "seo.ts").read_text(encoding="utf-8")
    found = re.findall(r"^export const ACTIVE_MONTHS = (\d+);$", source, flags=re.M)
    assert found == [str(es.ACTIVE_MONTHS)]


def test_the_part_names_are_the_ones_the_worker_serves():
    # No part for the organizations with nothing recent since 2026-11-21: the site marks their profiles noindex.
    assert es.SITEMAP_PARTS == ("open-tenders", "pages", "active-organizations")
    assert all(re.fullmatch(r"[a-z]+(?:-[a-z]+)*", name) for name in es.SITEMAP_PARTS)
    # The Worker writes these two itself; a pipeline part never takes their names.
    assert not {"contracts", "guides"} & set(es.SITEMAP_PARTS)
    assert set(es.SITEMAP_PAGE_FILES) == es.SITEMAP_DATED_PAGES <= set(es.SITEMAP_PAGES)


def test_the_export_writes_the_parts_in_order(conn, tmp_path):
    ids = seed_with_an_old_supplier(conn)
    out = tmp_path / "static"
    counts = es.export_static(conn, out, today=TODAY, base_url=BASE)
    parts = parts_of(out)
    assert [name for name, _, _ in parts] == ["sitemap-open-tenders-1.xml", "sitemap-pages-1.xml",
                                             "sitemap-active-organizations-1.xml"]
    tenders, pages, active = ([loc.replace(BASE, "") for loc, _ in entries] for _, _, entries in parts)

    # The open notices, newest first: by the night their newest version first appeared, then by publication date
    # (the backlog notice published in 2024 last), then by reference. The expired notice is in no part.
    assert tenders == ["/tenders/cb-100-1", "/tenders/cb-200-2", f"/tenders/{es.url_reference(COLON_REF).lower()}",
                       "/tenders/cb-300-3"]
    assert all(mod == "2026-10-31" for _, mod in parts[0][2])

    # The site's own pages: the fixed pages first, then buyers, segments, years, windows and directories.
    assert pages[:len(es.SITEMAP_PAGES)] == es.SITEMAP_PAGES
    assert "/buyers/dnd-mdn" in pages and "/buyers/never-buys" not in pages
    assert sum(p.startswith("/segments/") for p in pages) == 57
    assert {"/awards/2026", "/awards/2021", "/expiring/3m", "/expiring/12m", "/organizations/directory/on"} <= set(pages)
    assert "/awards/2029" not in pages
    assert not any(p.startswith(("/tenders/cb-", "/organizations/org-")) for p in pages)

    # Active: a record in the last 24 months, the most recent first (Northern's award of 2026-10-20, Acme's history
    # record of 2026-06-01, the foreign supplier's award of 2025-02-01). The supplier last seen in 2021 is not.
    assert active == [f"/organizations/{ids[n]}" for n in (NORTH, ACME, FOREIGN)]

    # Every other organization is in no part, by id anywhere in the files; nor is the supplier withheld as a
    # person, by id or by name.
    live = {r[0] for r in conn.execute("SELECT id FROM organizations")}
    assert {p.rsplit("/", 1)[1] for p in active} == live - {ids[OLD]}
    for path in (out / "sitemaps").iterdir():
        text = path.read_text(encoding="utf-8")
        assert PERSON not in text and PERSON_STREET not in text
        assert ids[OLD] not in text, path.name
    assert not any("?" in p for p in tenders + pages + active)

    assert counts["sitemap_files"] == 3
    assert counts["sitemap_open_tenders"] == 4 and counts["sitemap_active_organizations"] == 3
    assert "sitemap_other_organizations" not in counts and counts["sitemap_pages"] == len(pages)
    assert counts["sitemap_urls"] == len(tenders) + len(pages) + len(active)
    # The run status keeps the first 200 characters of the stage's detail, so the sitemap's counts lead it.
    detail = conn.execute("SELECT detail FROM sources_log WHERE source = 'export'").fetchone()[0]
    assert detail[:200].startswith("static sitemap_files=3 sitemap_urls=")
    assert "sitemap_active_organizations=3" in detail[:200] and "sitemap_other" not in detail

    text = (out / "sitemaps" / "index.xml").read_text(encoding="utf-8")
    assert text.startswith('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex ')
    assert "sitemap-contracts" not in text and "sitemap-guides" not in text


def test_the_pages_dated_by_the_data_and_the_pages_that_are_not(conn, tmp_path):
    seed(conn)
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    got = everything(out)
    assert got[f"{BASE}/"] == "2026-10-31" and got[f"{BASE}/overview"] == "2026-10-31"
    assert got[f"{BASE}/analytics"] == "2026-10-31"
    # Pages that change only with the code carry no date rather than a false one.
    for path in ("/methodology", "/alerts", "/pro", "/tenders/same-day", "/terms", "/watchlist"):
        assert got[f"{BASE}{path}"] is None, path
    # The site takes no donations: there is no support page to list.
    assert "/support" not in es.SITEMAP_PAGES and f"{BASE}/support" not in got
    # Organizations by the night their profile's figures last changed.
    for oid in [r[0] for r in conn.execute("SELECT id FROM organizations")]:
        assert got[f"{BASE}/organizations/{oid}"] == "2026-10-31"


def test_a_page_that_did_not_change_keeps_its_date_from_one_night_to_the_next(conn, tmp_path):
    ids = seed_with_an_old_supplier(conn)
    first = everything_after(conn, tmp_path / "one", TODAY)
    # The next night: the stages run again over the same records (the recompute and the buyers' figures with the
    # night's stamp), and nothing in them changed.
    organizations.recompute(conn, now="2026-11-01T13:00:00Z")
    indicators.compute(conn, now="2026-11-01T13:00:00Z")
    conn.commit()
    second = everything_after(conn, tmp_path / "two", TODAY + timedelta(days=1))
    # The second night's data date is past October's last day: the monthly record (monthly.py) takes October and
    # lets its oldest month go, so its index lists other months. No other address comes or goes.
    assert set(second) - set(first) == {f"{BASE}/monthly/2026-10"}
    assert set(first) - set(second) == {f"{BASE}/monthly/2025-10"}
    moved = {loc.replace(BASE, "") for loc in first if loc in second and first[loc] != second[loc]}
    # What moved really changed: the pages listing the night's runs (stats.json), the day's new notices (another
    # day's list), the radar and its windows (each row counts its days left), the monthly record's index, and the
    # part holding them. Every month already in the record keeps its date: its own figures did not move.
    assert moved == {"/", "/overview", "/data", "/tenders/new", "/expiring", "/expiring/3m", "/expiring/6m",
                     "/expiring/12m", "/monthly", "/sitemap-pages-1.xml"}
    assert all(second[f"{BASE}{p}"] == "2026-11-01" for p in moved)
    # Everything else kept its date: the open notices, the organizations, the buyers, the segments, the years, the
    # directories, the lists that did not move, and the parts and their index entries.
    for path in ("/tenders/cb-100-1", f"/organizations/{ids[ACME]}", f"/organizations/{ids[NORTH]}", "/buyers/dnd-mdn",
                 "/segments/72", "/awards/2026", "/awards/2021", "/organizations/directory/on", "/tenders", "/awards",
                 "/segments", "/rankings", "/feeds", "/organizations", "/buyers", "/monthly/2026-09", "/monthly/2025-11",
                 "/sitemap-open-tenders-1.xml", "/sitemap-active-organizations-1.xml"):
        assert second[f"{BASE}{path}"] == first[f"{BASE}{path}"] == "2026-10-31", path


def test_a_change_moves_the_date_of_the_pages_it_reaches_and_no_other(conn, tmp_path):
    ids = seed_with_an_old_supplier(conn)
    first = everything_after(conn, tmp_path / "one", TODAY)
    # The next night a 2021 notice of the old supplier is amended: its year's page and the part holding it change;
    # the other years, the organizations the parts name and the open notices do not. The supplier's own profile,
    # with nothing recent, is named by no part on either night.
    award(conn, "AW-OLD", 1, OLD, value=9_000.0, awarded="2021-05-05", published="2021-05-06", first_seen="2026-11-01")
    conn.commit()
    organizations.recompute(conn, now="2026-11-01T13:00:00Z")
    indicators.compute(conn, now="2026-11-01T13:00:00Z")
    conn.commit()
    second = everything_after(conn, tmp_path / "two", TODAY + timedelta(days=1))
    assert second[f"{BASE}/awards/2021"] == "2026-11-01"
    assert second[f"{BASE}/sitemap-pages-1.xml"] == "2026-11-01"
    for night in (first, second):
        assert f"{BASE}/organizations/{ids[OLD]}" not in night
    for path in (f"/organizations/{ids[ACME]}", "/awards/2026", "/tenders/cb-100-1", "/sitemap-open-tenders-1.xml",
                 "/sitemap-active-organizations-1.xml"):
        assert second[f"{BASE}{path}"] == first[f"{BASE}{path}"], path


def test_a_notice_that_closes_leaves_the_open_part(conn, tmp_path):
    seed(conn)
    out = tmp_path / "static"
    # cb-200-2 closes on 2026-11-03: open on that day, closed the day after.
    es.export_static(conn, out, today=date(2026, 11, 3), base_url=BASE)
    assert f"{BASE}/tenders/cb-200-2" in everything(out)
    es.export_static(conn, out, today=date(2026, 11, 4), base_url=BASE)
    got = everything(out)
    assert f"{BASE}/tenders/cb-200-2" not in got and f"{BASE}/tenders/cb-100-1" in got


def test_a_night_with_no_open_notice_and_no_active_organization_writes_only_the_parts_it_has(conn, tmp_path):
    out = tmp_path / "static"
    counts = es.export_static(conn, out, today=TODAY, base_url=BASE)
    assert [name for name, _, _ in parts_of(out)] == ["sitemap-pages-1.xml"]
    assert counts["sitemap_files"] == 1 and counts["sitemap_open_tenders"] == 0


def everything_after(conn, out, day):
    es.export_static(conn, out, today=day, base_url=BASE)
    return everything(out)


SITE_FIXTURES = Path(__file__).resolve().parents[2] / "site" / "test" / "fixtures" / "sitemaps"


def test_the_site_serves_files_shaped_as_the_export_writes_them(tmp_path):
    """site/test/sitemaps.test.ts serves these files as the export's: written again from their own entries, each
    comes out byte for byte the same, so the Worker is tested against the export's real format."""
    origin = "https://awardwatch.ca"
    parts = []
    for loc, _ in locs(parse(SITE_FIXTURES / "index.xml"), "sitemap"):
        file = loc.rsplit("/", 1)[1]
        name = file[len("sitemap-"):-len(".xml")].rsplit("-", 1)[0]
        parts.append((name, [(u.replace(origin, ""), mod) for u, mod in locs(parse(SITE_FIXTURES / file), "url")]))
    assert [name for name, _ in parts] == list(es.SITEMAP_PARTS)
    es.write_sitemaps(parts, tmp_path, origin)
    written = sorted(p.name for p in (tmp_path / "sitemaps").iterdir())
    assert written == sorted(p.name for p in SITE_FIXTURES.iterdir())
    for name in written:
        assert (tmp_path / "sitemaps" / name).read_bytes() == (SITE_FIXTURES / name).read_bytes(), name
