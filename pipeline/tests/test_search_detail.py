"""Search Console's figures by page and by query (search_detail.py), against a stub session: nothing here reaches
the network. The answers are written from the Search Analytics API's reference (searchanalytics.query: rows of
keys, clicks, impressions, ctr, position), never recorded from a real call."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

from awardwatch_pipeline import config, search_console as sc, search_detail as sd
from test_search_console import ACCOUNT_JSON, KEY_FRAGMENT, FakeResponse

ENV = {sc.SECRET_ENV: ACCOUNT_JSON}
NOW = datetime(2026, 11, 19, 13, 40, tzinfo=timezone.utc)
SITE = "https://awardwatch.ca"


def pages_of(day: str) -> list[dict]:
    """One day's page rows as Search Console sorts them (by clicks), with ties Google orders as it likes."""
    return [
        {"keys": [f"{SITE}/organizations/org-a000000001"], "clicks": 3, "impressions": 40, "ctr": 0.075, "position": 6.2},
        {"keys": [f"{SITE}/tenders/cb-100-10000001"], "clicks": 1, "impressions": 9, "ctr": 0.11, "position": 3.0},
        {"keys": [f"{SITE}/history/w8472-000633"], "clicks": 0, "impressions": 12, "ctr": 0, "position": 11.5},
        {"keys": [f"{SITE}/contracts/dnd-mdn/W8472%2F000633"], "clicks": 0, "impressions": 30, "ctr": 0, "position": 9.0},
        {"keys": ["https://www.awardwatch.ca/"], "clicks": 1, "impressions": 9, "ctr": 0.11, "position": 1.0},
        {"keys": ["https://elsewhere.example/awardwatch.ca/"], "clicks": 5, "impressions": 50},
        {"keys": [f"{SITE}/a\x00b"], "clicks": 0, "impressions": 1},
        {"keys": []}, {"clicks": 9},
    ]


def queries_of(day: str) -> list[dict]:
    return [
        {"keys": ["canadabuys award notices"], "clicks": 2, "impressions": 30, "position": 4.0},
        {"keys": ["marie sampleton"], "clicks": 1, "impressions": 10, "position": 2.0},
        {"keys": ["jane doe"], "clicks": 0, "impressions": 30, "position": 6.0},
        {"keys": ["standing offer translation\t"], "clicks": 0, "impressions": 4, "position": 12.0},
    ]


class FakeGoogle:
    """The token endpoint and the Search Analytics API, answering per day."""

    def __init__(self, days: list[str] | None = None, *, fail_on: tuple[str, str] | None = None,
                 fail: FakeResponse | Exception | None = None) -> None:
        self.days = ["2026-11-01", "2026-11-02", "2026-11-14", "2026-11-16"] if days is None else days
        self.fail_on = fail_on
        self.fail = fail
        self.calls: list[dict] = []
        self.closed = False

    def post(self, url, data=None, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "data": data, "json": json, "headers": headers or {}})
        if url == sc.TOKEN_URL:
            return FakeResponse(200, {"access_token": "ya29.test-token", "expires_in": 3599, "token_type": "Bearer"})
        dims = json["dimensions"]
        if self.fail is not None and (self.fail_on is None or (json["startDate"], dims[0]) == self.fail_on):
            if isinstance(self.fail, Exception):
                raise self.fail
            return self.fail
        if dims == ["date"]:
            rows = [{"keys": [d], "clicks": 1, "impressions": 10, "ctr": 0.1, "position": 5.0}
                    for d in self.days if json["startDate"] <= d <= json["endDate"]]
            return FakeResponse(200, {"rows": rows, "responseAggregationType": "byProperty"})
        rows = pages_of(json["startDate"]) if dims == ["page"] else queries_of(json["startDate"])
        return FakeResponse(200, {"rows": rows, "responseAggregationType": "byPage" if dims == ["page"] else "byProperty"})

    def close(self):
        self.closed = True


def read(path, header) -> list[dict]:
    reader = csv.DictReader(io.StringIO(path.read_text(encoding="utf-8")))
    assert reader.fieldnames == header
    return list(reader)


def run(tmp_path, http=None, **kw):
    return sd.run(tmp_path, env=kw.pop("env", ENV), session=http if http is not None else FakeGoogle(),
                  now=kw.pop("now", NOW), **kw)


@pytest.fixture(autouse=True)
def site(monkeypatch):
    monkeypatch.setattr(config, "SITE_URL", SITE)


def test_without_the_secret_nothing_is_asked(tmp_path):
    http = FakeGoogle()
    assert run(tmp_path, http, env={}) == "no credentials"
    assert http.calls == [] and not (tmp_path / sd.PAGES_FILE).exists()


def test_the_first_night_backfills_from_november_first_each_day_its_pages_and_queries(tmp_path, caplog):
    caplog.set_level("INFO")
    http = FakeGoogle()
    assert run(tmp_path, http) == "imported 4 days"
    token, dates, *per_day = http.calls
    assert token["url"] == sc.TOKEN_URL
    assert dates["json"] == {"type": "web", "dataState": "final", "startDate": "2026-11-01", "endDate": "2026-11-18",
                             "dimensions": ["date"], "rowLimit": 25000}
    assert [(c["json"]["startDate"], c["json"]["dimensions"]) for c in per_day] == [
        (d, [dim]) for d in ("2026-11-01", "2026-11-02", "2026-11-14", "2026-11-16") for dim in ("page", "query")]
    for c in per_day:
        assert c["json"]["endDate"] == c["json"]["startDate"] and c["json"]["rowLimit"] == sd.ROWS_ASKED
        assert c["json"]["dataState"] == "final" and c["headers"]["Authorization"] == "Bearer ya29.test-token"
    pages = read(tmp_path / sd.PAGES_FILE, sd.PAGES_HEADER)
    first = [(r["page"], r["clicks"], r["impressions"], r["position"]) for r in pages if r["date"] == "2026-11-01"]
    # Ranked here: most clicks, then most impressions; the site's own pages only (www included), no control byte.
    assert first == [
        (f"{SITE}/organizations/org-a000000001", "3", "40", "6.2"),
        (f"{SITE}/tenders/cb-100-10000001", "1", "9", "3.0"),
        ("https://www.awardwatch.ca/", "1", "9", "1.0"),
        (f"{SITE}/contracts/dnd-mdn/W8472%2F000633", "0", "30", "9.0"),
        (f"{SITE}/history/w8472-000633", "0", "12", "11.5"),
    ]
    queries = read(tmp_path / sd.QUERIES_FILE, sd.QUERIES_HEADER)
    day = [(r["query"], r["clicks"], r["impressions"], r["position"]) for r in queries if r["date"] == "2026-11-01"]
    # Two queries that read as people's names become one withheld row, its position weighted by impressions.
    assert day == [("canadabuys award notices", "2", "30", "4.0"), (sd.WITHHELD, "1", "40", "5.0"),
                   ("standing offer translation", "0", "4", "12.0")]
    text = (tmp_path / sd.QUERIES_FILE).read_text(encoding="utf-8")
    assert "sampleton" not in text and "jane" not in text
    assert "\r" not in (tmp_path / sd.PAGES_FILE).read_bytes().decode("utf-8")
    assert KEY_FRAGMENT not in caplog.text and "ya29.test-token" not in caplog.text
    for figure in ("40", "30", "6.2"):
        assert f" {figure} " not in caplog.text


def test_a_later_night_starts_after_the_newest_day_both_files_hold(tmp_path):
    assert run(tmp_path, FakeGoogle(days=["2026-11-01", "2026-11-02"])) == "imported 2 days"
    http = FakeGoogle()
    later = datetime(2026, 11, 20, 2, 0, tzinfo=timezone.utc)
    assert run(tmp_path, http, now=later) == "imported 2 days"
    assert http.calls[1]["json"]["startDate"] == "2026-11-03" and http.calls[1]["json"]["endDate"] == "2026-11-19"
    assert sorted({r["date"] for r in read(tmp_path / sd.PAGES_FILE, sd.PAGES_HEADER)}) == [
        "2026-11-01", "2026-11-02", "2026-11-14", "2026-11-16"]
    # A day one file holds and the other lacks is asked for the other alone.
    pages = read(tmp_path / sd.PAGES_FILE, sd.PAGES_HEADER)
    sd.write_rows(tmp_path / sd.PAGES_FILE, sd.PAGES_HEADER, [r for r in pages if r["date"] != "2026-11-16"])
    http = FakeGoogle()
    assert run(tmp_path, http, now=later) == "imported 1 day"
    assert [(c["json"]["startDate"], c["json"]["dimensions"]) for c in http.calls[2:]] == [("2026-11-16", ["page"])]
    # Up to date: nothing final after the newest day held.
    idle = FakeGoogle(days=[])
    assert run(tmp_path, idle, now=later) == "up to date"
    assert run(tmp_path, FakeGoogle(), now=datetime(2026, 11, 17, 1, tzinfo=timezone.utc)) == "up to date"


def test_at_most_max_days_a_night_and_never_before_the_history_search_console_keeps(tmp_path, monkeypatch):
    monkeypatch.setattr(sd, "MAX_DAYS", 3)
    assert run(tmp_path, FakeGoogle()) == "imported 3 days"
    assert sorted({r["date"] for r in read(tmp_path / sd.QUERIES_FILE, sd.QUERIES_HEADER)}) == [
        "2026-11-01", "2026-11-02", "2026-11-14"]
    assert sd.start_day([], [], date(2028, 3, 1)) == date(2028, 3, 1) - timedelta(days=sc.HISTORY_DAYS)


def test_top_rows_are_capped():
    rows = [{"keys": [f"q{i:03d}"], "clicks": i % 5, "impressions": i, "position": 2} for i in range(400)]
    out = sd.ranked(rows, "query", SITE)
    assert len(out) == sd.TOP_ROWS
    assert [r[1] for r in out] == sorted((r[1] for r in out), reverse=True)
    assert out[0] == ["q399", 4, 399, 2.0]


@pytest.mark.parametrize("fail", [
    FakeResponse(403, {"error": {"code": 403, "message": "User does not have sufficient permission"}}),
    FakeResponse(500, None, "backend error"),
    FakeResponse(200, {"rows": "none"}),
    requests.Timeout("slow"),
])
def test_a_failure_part_way_leaves_both_files_as_they_were(tmp_path, fail):
    assert run(tmp_path, FakeGoogle(days=["2026-11-01"])) == "imported 1 day"
    before = [(tmp_path / f).read_bytes() for f in (sd.PAGES_FILE, sd.QUERIES_FILE)]
    http = FakeGoogle(fail_on=("2026-11-14", "query"), fail=fail)
    assert run(tmp_path, http) == "failed"
    assert [(tmp_path / f).read_bytes() for f in (sd.PAGES_FILE, sd.QUERIES_FILE)] == before


def test_a_stored_file_that_cannot_be_read_safely_is_never_replaced(tmp_path):
    for text in ("", "date,page\n2026-11-01,x\n", ",".join(sd.PAGES_HEADER) + "\nnot-a-date,x,1,2,3\n",
                 ",".join(sd.PAGES_HEADER) + "\n2026-11-01,x,1,2,3,extra\n"):
        (tmp_path / sd.PAGES_FILE).write_text(text, encoding="utf-8")
        http = FakeGoogle()
        assert run(tmp_path, http) == "failed", text
        assert (tmp_path / sd.PAGES_FILE).read_text(encoding="utf-8") == text and http.calls == []
        assert not (tmp_path / sd.QUERIES_FILE).exists()


def test_own_pages():
    assert sd.own_page("https://awardwatch.ca/x", SITE) and sd.own_page("http://www.awardwatch.ca/", SITE)
    for url in ("https://awardwatch.ca.example/", "ftp://awardwatch.ca/", "https://elsewhere.example/awardwatch.ca",
                "not a url", "https://notawardwatch.ca/"):
        assert not sd.own_page(url, SITE), url
