"""The organization directory: A to Z by province, 200 to a page, xx and un for the rest, and the
ledger that dates each page by the night its rows last changed."""

import json

from awardwatch_pipeline import directory
from awardwatch_pipeline.db import now_iso

NOW = "2026-10-12T00:00:00Z"


def org(conn, oid, name, norm, *, province="BC", country="CA", city="Kelowna", n_awards=1, last_seen="2026-10-01"):
    conn.execute(
        "INSERT INTO organizations (id, display_name, norm_name, country, province, city, n_awards, n_contracts, "
        "last_seen, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?, ?)",
        (oid, name, norm, country, province, city, n_awards, last_seen, now_iso()))


def load(out, rel):
    return json.loads((out / rel).read_text(encoding="utf-8"))


def test_pages_split_at_the_page_size_in_name_order(conn, tmp_path, monkeypatch):
    monkeypatch.setattr(directory, "PAGE_SIZE", 2)
    for i, name in enumerate(["Delta Ltd", "alpha inc", "Charlie Co", "1234567 BC Ltd", "Bravo"]):
        org(conn, f"org-00000000{i:02d}", name, name.lower().replace(" ltd", "").replace(" inc", "").replace(" co", ""))
    counts = directory.write_all(conn, tmp_path, "2026-10-12")
    assert counts == {"directory_pages": 3, "directory_organizations": 5}
    part = load(tmp_path, "directory/bc/index.json")
    assert part["organizations"] == 5 and part["pages"] == 3 and part["page_size"] == 2
    assert part["ranges"] == [["1234567 BC Ltd", "alpha inc"], ["Bravo", "Charlie Co"], ["Delta Ltd", "Delta Ltd"]]
    assert part["letters"] == [["#", 1], ["A", 1], ["B", 2], ["C", 2], ["D", 3]]
    assert part["updated"] == "2026-10-12"
    page = load(tmp_path, "directory/bc/1.json")
    assert page["code"] == "bc" and page["page"] == 1
    assert page["rows"][0] == {"id": "org-0000000003", "name": "1234567 BC Ltd", "city": "Kelowna", "n_records": 3,
                               "last_seen": "2026-10-01"}
    index = load(tmp_path, "directory/index.json")
    assert [d["code"] for d in index["directories"]] == directory.CODES
    assert next(d for d in index["directories"] if d["code"] == "bc")["pages"] == 3


def test_a_province_with_no_organizations_has_an_index_and_no_pages(conn, tmp_path):
    org(conn, "org-0000000001", "Alpha Ltd", "alpha")
    directory.write_all(conn, tmp_path, "2026-10-12")
    part = load(tmp_path, "directory/yt/index.json")
    assert (part["organizations"], part["pages"], part["ranges"], part["letters"], part["updated"]) == (0, 0, [], [], None)
    assert not (tmp_path / "directory" / "yt" / "1.json").exists()
    assert [p for p, _ in directory.sitemap_entries(conn)] == ["/organizations/directory/bc"]


def test_outside_canada_and_unknown_have_directories_of_their_own(conn, tmp_path):
    org(conn, "org-0000000001", "Overseas GmbH", "overseas", country="DE", province=None)
    org(conn, "org-0000000002", "Nowhere Ltd", "nowhere", country=None, province=None)
    org(conn, "org-0000000003", "Canada Only Ltd", "canada only", country="CA", province=None)
    directory.write_all(conn, tmp_path, "2026-10-12")
    assert [r["id"] for r in load(tmp_path, "directory/xx/1.json")["rows"]] == ["org-0000000001"]
    assert [r["id"] for r in load(tmp_path, "directory/un/1.json")["rows"]] == ["org-0000000003", "org-0000000002"]
    assert directory.code_for("CA", "ON") == "on" and directory.code_for("US", None) == "xx"
    assert directory.code_for(None, None) == "un" and directory.code_for("CA", None) == "un"


def test_only_changed_pages_get_a_new_date(conn, tmp_path, monkeypatch):
    monkeypatch.setattr(directory, "PAGE_SIZE", 1)
    org(conn, "org-0000000001", "Alpha Ltd", "alpha")
    org(conn, "org-0000000002", "Bravo Ltd", "bravo")
    directory.write_all(conn, tmp_path / "a", "2026-10-12")
    conn.execute("UPDATE organizations SET n_awards = 5 WHERE id = 'org-0000000002'")
    directory.write_all(conn, tmp_path / "b", "2026-10-13")
    assert dict(directory.sitemap_entries(conn)) == {"/organizations/directory/bc": "2026-10-12",
                                                     "/organizations/directory/bc/2": "2026-10-13"}
    assert load(tmp_path / "b", "directory/bc/index.json")["updated"] == "2026-10-13"
    conn.execute("DELETE FROM organizations WHERE id = 'org-0000000002'")
    directory.write_all(conn, tmp_path / "c", "2026-10-14")
    assert dict(directory.sitemap_entries(conn)) == {"/organizations/directory/bc": "2026-10-12"}


def test_initials_file_digits_and_other_scripts_under_one_mark():
    assert directory.initial("acme") == "A" and directory.initial("1234 bc") == "#"
    assert directory.initial("") == "#" and directory.initial("ébène") == "#"
    assert directory.page_path("on", 1) == "/organizations/directory/on"
    assert directory.page_path("on", 3) == "/organizations/directory/on/3"


def test_a_row_with_no_record_counted_carries_no_last_record_date(conn, tmp_path):
    """A last record date beside a count of 0 would name a record the row does not count."""
    conn.execute(
        "INSERT INTO organizations (id, display_name, norm_name, country, province, city, last_seen, updated_at) "
        "VALUES ('org-0000000099', 'Pulse Growers', 'pulse growers', 'CA', 'SK', 'Saskatoon', '2018-04-01', ?)", (now_iso(),))
    org(conn, "org-0000000098", "Prairie Seeds", "prairie seeds", province="SK")
    directory.write_all(conn, tmp_path, "2026-10-12")
    rows = {r["id"]: r for r in load(tmp_path, "directory/sk/1.json")["rows"]}
    assert rows["org-0000000099"]["n_records"] == 0 and rows["org-0000000099"]["last_seen"] is None
    assert rows["org-0000000098"]["n_records"] == 3 and rows["org-0000000098"]["last_seen"] == "2026-10-01"
