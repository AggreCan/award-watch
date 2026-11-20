"""The monthly report's additions of 2026-11-19: the classes counted apart, the account steps, the note on the days
that counted the crawler pool as people, and the Search block. From rows written here."""

from __future__ import annotations

import json
from datetime import date, timedelta

from awardwatch_pipeline import funnel, index_sample as ix, search_console as sc, search_detail as sd
from awardwatch_pipeline import views_report as vrep, views_rollup as vr
from test_views_report import summary_row, table_row

SITE = "https://awardwatch.ca"


def november() -> list[dict]:
    rows = []
    for day in range(1, 31):
        stamp = f"2026-11-{day:02d}"
        human = 80000 if 13 <= day <= 19 else 100
        row = summary_row(stamp, human_pages=human, bot_pages=900, human_by_country=json.dumps({"CA": human}),
                          human_by_device=json.dumps({"desktop": human}), human_by_lang=json.dumps({"en": human}),
                          human_by_route=json.dumps({"/organizations/:id": human}))
        if day >= 20:  # the Worker's rule from the 20th
            row.update(hosted_pages=70000, closed_pages=2890, hosted_by_country="{}", hosted_by_route="{}",
                       plans_pages=3, sign_in_pages=2)
        rows.append(row)
    return rows


def search_days() -> list[dict]:
    rows = []
    for day in range(1, 29):  # the newest final day imported is the 28th
        clicks = 9 if day < 14 else 1
        rows.append({"date": f"2026-11-{day:02d}", "clicks": clicks, "impressions": 400 if day < 16 else 150,
                     "ctr": 0.02, "position": 8.0, "top_queries": "[]"})
    return rows


def pages_and_queries() -> tuple[list[dict], list[dict]]:
    pages, queries = [], []
    for day in range(8, 29):
        stamp = f"2026-11-{day:02d}"
        early = day <= 21
        pages.append({"date": stamp, "page": f"{SITE}/organizations/org-a000000001", "clicks": 2 if early else 0,
                      "impressions": 30, "position": 5.0})
        pages.append({"date": stamp, "page": f"{SITE}/tenders/cb-100-10000001", "clicks": 1 if early else 0,
                      "impressions": 10, "position": 3.0})
        pages.append({"date": stamp, "page": f"https://www.awardwatch.ca/history/w8472-000633?lang=fr",
                      "clicks": 0 if early else 1, "impressions": 5, "position": 9.0})
        queries.append({"date": stamp, "query": "award watch", "clicks": 3 if early else 1, "impressions": 40,
                        "position": 2.0})
        queries.append({"date": stamp, "query": "tender | pipes", "clicks": 1 if early else 0, "impressions": 4,
                        "position": 7.0})
    return pages, queries


def index_rows() -> list[dict]:
    rows = []
    for night, indexed in (("2026-11-29", 10), ("2026-11-30", 12), ("2026-12-01", 0)):
        for i in range(15):
            ok = i < indexed
            rows.append({"date": night, "kind": "tender", "path": f"/tenders/cb-{i}", "verdict": "PASS" if ok else "NEUTRAL",
                         "coverage": "Submitted and indexed" if ok else ("URL is unknown to Google" if i % 2 else
                                                                         "Crawled - currently not indexed"),
                         "robots": "ALLOWED", "indexing": "INDEXING_ALLOWED", "fetch": "SUCCESSFUL",
                         "last_crawl": "", "google_canonical": ""})
        for i in range(10):
            rows.append({"date": night, "kind": "contract", "path": f"/contracts/dnd-mdn/W{i}", "verdict": "PASS",
                         "coverage": "Submitted and indexed", "robots": "ALLOWED", "indexing": "INDEXING_ALLOWED",
                         "fetch": "SUCCESSFUL", "last_crawl": "", "google_canonical": ""})
    return rows


def funnel_rows() -> list[dict]:
    return [{"date": f"2026-11-{d:02d}", "accounts": 10, "accounts_new": 1, "codes_requested": 2, "sign_ins": 1, "pro": 1,
             "saved_searches": 3, "watches": 4, "first_saves": "" if d < 20 else 1} for d in range(1, 31)]


def write(tmp_path) -> dict:
    paths = {name: tmp_path / name for name in ("summary.csv", "search_console.csv", "funnel.csv", "pages.csv",
                                                 "queries.csv", "index.csv")}
    vr._write_csv(paths["summary.csv"], vr.SUMMARY_HEADER, november())
    sc.write_file(paths["search_console.csv"], search_days())
    vr._write_csv(paths["funnel.csv"], funnel.HEADER, funnel_rows())
    pages, queries = pages_and_queries()
    sd.write_rows(paths["pages.csv"], sd.PAGES_HEADER, pages)
    sd.write_rows(paths["queries.csv"], sd.QUERIES_HEADER, queries)
    sd.write_rows(paths["index.csv"], ix.HEADER, index_rows())
    return paths


def report(tmp_path, **paths) -> str:
    out = tmp_path / "out"
    assert vrep.run(out, "2026-11", date(2026, 12, 1), paths["summary.csv"], paths.get("search_console.csv"),
                    funnel_path=paths.get("funnel.csv"), pages_path=paths.get("pages.csv"),
                    queries_path=paths.get("queries.csv"), index_path=paths.get("index.csv")) == "written"
    return (out / "report-2026-11.md").read_text(encoding="utf-8")


def test_the_table_counts_the_classes_apart_and_the_steps_to_an_account(tmp_path):
    text = report(tmp_path, **write(tmp_path))
    assert table_row(text, "Days with the classes counted apart")[-1] == "11 of 30"
    assert table_row(text, "Page views from hosted networks (not people)")[-1] == "770,000"
    assert table_row(text, "Response form opened not from its profile (not people)")[-1] == "31,790"
    assert table_row(text, "Plans page views by people")[-1] == "33"
    assert table_row(text, "Sign-in page views by people")[-1] == "22"
    assert table_row(text, "Days with account counts")[-1] == "30 of 30"
    assert table_row(text, "Sign-in codes asked for")[-1] == "60"
    assert table_row(text, "Accounts made")[-1] == "30"
    assert table_row(text, "Accounts with a first saved search or watch")[-1] == "11"
    # The months before the rule read n/a, never 0.
    assert table_row(text, "Page views from hosted networks (not people)")[:3] == ["n/a"] * 3
    for dash in (chr(0x2014), chr(0x2013)):
        assert dash not in text


def test_the_report_names_the_days_that_counted_the_pool_as_people_and_keeps_them_as_counted(tmp_path):
    text = report(tmp_path, **write(tmp_path))
    assert "Days that counted a crawler pool as people: 2026-11-13 to 2026-11-19 (7 days). From 2026-11-13 " in text
    # History is not rewritten: those days' page views stay in the month's people figure.
    assert table_row(text, "Page views by people")[-1] == f"{7 * 80000 + 23 * 100:,}"
    paths = write(tmp_path)
    rows = [r for r in november() if r["date"] < "2026-11-13" or r["date"] >= "2026-11-20"]
    vr._write_csv(paths["summary.csv"], vr.SUMMARY_HEADER, rows)
    assert "crawler pool" not in report(tmp_path, **paths)


def test_the_search_block(tmp_path):
    text = report(tmp_path, **write(tmp_path))
    block = text.split("## Search\n\n", 1)[1].split("\n## ", 1)[0]
    assert block.startswith("Clicks and impressions by day, the 28 days to 2026-11-28 (the newest final day imported):")
    assert "| 2026-11-01 | 9 | 400 |" in block and "| 2026-11-28 | 1 | 150 |" in block
    assert block.count("\n| 2026-11-") == 28
    pages = block.split("Pages that lost the most clicks, the 7 days to 2026-11-28 against the 7 before:", 1)[1]
    pages = pages.split("Queries that lost", 1)[0]
    assert "| /organizations/org-a000000001 | 14 | 0 | -14 |" in pages
    assert "| /tenders/cb-100-10000001 | 7 | 0 | -7 |" in pages
    assert "www /history" not in pages  # it gained clicks, so it is not listed
    assert pages.index("org-a000000001") < pages.index("cb-100-10000001")
    queries = block.split("Queries that lost the most clicks", 1)[1].split("The index sample", 1)[0]
    assert "| award watch | 21 | 7 | -14 |" in queries
    assert "| tender / pipes | 7 | 0 | -7 |" in queries  # a pipe never breaks the table
    index = block.split("The index sample of ", 1)[1]
    # The newest night up to the month's end, by kind of page, with Google's reasons.
    assert index.startswith("2026-11-30 (2 nights sampled this month):")
    assert "| tender | 15 | 12 | 80.0% | Crawled - currently not indexed 2; URL is unknown to Google 1 |" in index
    assert "| contract | 10 | 10 | 100.0% | none |" in index


def test_the_search_block_says_what_it_lacks(tmp_path):
    paths = write(tmp_path)
    text = report(tmp_path, **{"summary.csv": paths["summary.csv"]})
    block = text.split("## Search\n\n", 1)[1].split("\n## ", 1)[0]
    assert block.startswith("No Search Console figures were imported for this month.")
    assert "No index sample was taken by the month's end." in block
    # Files that hold fewer days than the comparison needs say how many they hold.
    pages, _ = pages_and_queries()
    sd.write_rows(paths["pages.csv"], sd.PAGES_HEADER, [p for p in pages if p["date"] >= "2026-11-18"])
    text = report(tmp_path, **paths)
    assert "(the file holds 11 of these 14 days)" in text


def test_the_loss_window():
    end = date(2026, 11, 28)
    rows = [{"date": (end - timedelta(days=i)).isoformat(), "query": "q", "clicks": "1"} for i in range(20)]
    lost, held = vrep.losses(rows, "query", end)
    assert held == 14 and lost == []
    rows.append({"date": (end - timedelta(days=13)).isoformat(), "query": "r", "clicks": "4"})
    lost, _ = vrep.losses(rows, "query", end)
    assert lost == [("r", 4, 0)]
