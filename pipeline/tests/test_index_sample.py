"""The nightly index sample (index_sample.py), against a stub session and files written here: nothing reaches the
network. Google's answers are written from the URL Inspection API's reference (urlInspection.index.inspect, its
InspectUrlIndexResponse and IndexStatusInspectionResult), never recorded from a real call."""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, datetime, timedelta, timezone

import pytest

from awardwatch_pipeline import config, index_sample as ix, nightly, resilience, search_console as sc
from test_search_console import ACCOUNT_JSON, KEY_FRAGMENT, FakeResponse

ENV = {sc.SECRET_ENV: ACCOUNT_JSON}
NOW = datetime(2026, 11, 19, 13, 50, tzinfo=timezone.utc)
AS_OF = date(2026, 11, 18)
SITE = "https://awardwatch.ca"


def answer(verdict: str, coverage: str, path: str, *, fetch: str = "SUCCESSFUL", crawl: str | None = "2026-11-17T09:12:44Z",
           canonical: str | None = None) -> dict:
    """An inspection result in the reference's shape, with the fields the sample keeps and some it does not."""
    status = {"verdict": verdict, "coverageState": coverage, "robotsTxtState": "ALLOWED", "indexingState": "INDEXING_ALLOWED",
              "pageFetchState": fetch, "crawledAs": "MOBILE", "userCanonical": f"{SITE}{path}",
              "sitemap": [f"{SITE}/sitemap-3.xml"], "referringUrls": [f"{SITE}/organizations"]}
    if crawl:
        status["lastCrawlTime"] = crawl
    status["googleCanonical"] = canonical if canonical is not None else f"{SITE}{path}"
    return {"inspectionResult": {"inspectionResultLink": "https://search.google.com/search-console/inspect?resource_id=x",
                                 "indexStatusResult": status,
                                 "mobileUsabilityResult": {"verdict": "VERDICT_UNSPECIFIED"}}}


def write_static(folder, tenders: int = 20, awards: int = 20, buyers: bool = True) -> None:
    (folder / "tenders").mkdir(parents=True, exist_ok=True)
    (folder / "awards").mkdir(parents=True, exist_ok=True)
    (folder / "stats.json").write_text(json.dumps({"data_as_of": AS_OF.isoformat()}), encoding="utf-8")
    rows = [{"reference": f"CB-{100 + i}-1000{i:04d}", "published": (AS_OF - timedelta(days=i % 10)).isoformat()}
            for i in range(tenders)]
    rows.append({"reference": "bad reference/with slash", "published": AS_OF.isoformat()})
    (folder / "tenders" / "open.json").write_text(json.dumps(rows), encoding="utf-8")
    recent = [{"organization_id": f"org-b{i:09x}", "awarded": (AS_OF - timedelta(days=2 * i)).isoformat()}
              for i in range(awards)]
    recent.append({"organization_id": None, "awarded": AS_OF.isoformat()})
    (folder / "awards" / "recent.json").write_text(json.dumps(recent), encoding="utf-8")
    if buyers:
        # Ten buyers with open notices, three with none, and rows the sample must pass over.
        index = [{"id": f"buyer-{i:02d}", "n_open_tenders": i + 1} for i in range(10)]
        index += [{"id": f"quiet-{i}", "n_open_tenders": 0} for i in range(3)]
        index += [{"id": "Not A Buyer", "n_open_tenders": 4}, {"id": "no-count"}, {"id": "true-count", "n_open_tenders": True}, "x"]
        (folder / "buyers").mkdir(exist_ok=True)
        (folder / "buyers" / "index.json").write_text(json.dumps({"buyers": index}), encoding="utf-8")


class FakeGoogle:
    """The token endpoint and the URL Inspection API. answers maps a page's path to its status (or an exception),
    default an indexed page."""

    def __init__(self, answers: dict | None = None, default: object = None) -> None:
        self.answers = answers or {}
        self.default = default
        self.calls: list[dict] = []
        self.closed = False

    def post(self, url, data=None, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": headers or {}})
        if url == sc.TOKEN_URL:
            return FakeResponse(200, {"access_token": "ya29.test-token", "expires_in": 3599, "token_type": "Bearer"})
        path = json["inspectionUrl"][len(SITE):]
        got = self.answers.get(path, self.default)
        if isinstance(got, Exception):
            raise got
        if isinstance(got, FakeResponse):
            return got
        return FakeResponse(200, got if got is not None else answer("PASS", "Submitted and indexed", path))

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def site(monkeypatch):
    monkeypatch.setattr(config, "SITE_URL", SITE)


@pytest.fixture
def world(tmp_path):
    # The second is the database path the command still takes (--db); nothing reads it since 2026-11-22.
    static, db = tmp_path / "static", tmp_path / "awardwatch.sqlite"
    write_static(static)
    return static, db


def run(tmp_path, world, http, **kw):
    static, db = world
    sleeps: list[float] = []
    outcome = ix.run(tmp_path / "out", env=kw.pop("env", ENV), session=http, now=kw.pop("now", NOW), static=static,
                     db=db, sleep=sleeps.append, clock=kw.pop("clock", lambda: 0.0), **kw)
    return outcome, sleeps


def rows_of(tmp_path) -> list[dict]:
    reader = csv.DictReader(io.StringIO((tmp_path / "out" / ix.FILE).read_text(encoding="utf-8")))
    assert reader.fieldnames == ix.HEADER
    return list(reader)


# -- the sample ---------------------------------------------------------------------


def test_the_sample_takes_each_kinds_share_from_its_window(world):
    static, _ = world
    found = ix.candidates(static)
    # Tenders published in the 7 days to the data date, as the sitemaps write them (lower case).
    assert found["tender"] == sorted(f"/tenders/cb-{100 + i}-1000{i:04d}" for i in range(20) if i % 10 < 7)
    # Organizations with an award notice in the 30 days to it.
    assert found["organization"] == sorted(f"/organizations/org-b{i:09x}" for i in range(15))
    # The buyers with an open notice on the data date, whose pages list those notices; a buyer with none, a row
    # that is no buyer id and a count that is no number are passed over. No published contract: robots.txt closes them.
    assert found["buyer"] == [f"/buyers/buyer-{i:02d}" for i in range(10)]
    assert "contract" not in found and not any(p.startswith("/contracts/") for paths in found.values() for p in paths)
    # The list pages that follow the data with the guides' index (no monthly record in this export), and the
    # guides as the site's own file names them.
    assert "/tenders" in found["page"] and "/guides" in found["page"] and "/privacy" not in found["page"]
    assert not any(p.startswith("/monthly/") for p in found["page"])
    assert len(found["guide"]) >= 16 and all(re.fullmatch(r"/guides/[a-z0-9-]+", p) for p in found["guide"])
    sample = ix.draw(found)
    kinds = [k for k, _ in sample]
    assert {k: kinds.count(k) for k in set(kinds)} == {"tender": 12, "organization": 12, "page": 6, "guide": 4, "buyer": 6}
    # One page of each kind a round, in the order SAMPLE names them, until a kind has given its share.
    assert kinds[:20] == ["tender", "organization", "page", "guide", "buyer"] * 4
    assert kinds[20:26] == ["tender", "organization", "page", "buyer"] + ["tender", "organization"]
    assert kinds[-12:] == ["tender", "organization"] * 6
    # Each kind's pages are its lowest-ranked candidates, in rank order.
    for kind, share in ix.SAMPLE:
        assert [p for k, p in sample if k == kind] == sorted(set(found[kind]), key=lambda p: ix.rank(kind, p))[:share]
    assert len(sample) == ix.SAMPLE_SIZE == 40


def test_the_sample_is_the_same_each_night_and_rolls_slowly(world):
    static, _ = world
    found = ix.candidates(static)
    first = ix.draw(found)
    assert ix.draw(found) == first
    # A new tender joins the window: at most one tender changes, and the other kinds not at all.
    grown = {**found, "tender": found["tender"] + ["/tenders/cb-999-10009999"]}
    second = ix.draw(grown)
    assert len(set(second) - set(first)) <= 1
    assert [p for k, p in second if k != "tender"] == [p for k, p in first if k != "tender"]
    # The rank is a fixed function of the kind and the path.
    assert ix.rank("tender", "/tenders/x") == ix.rank("tender", "/tenders/x") != ix.rank("buyer", "/tenders/x")


def test_no_export_or_a_missing_file_gives_what_is_there(tmp_path):
    assert ix.candidates(tmp_path / "none") == {}
    static = tmp_path / "static"
    write_static(static, buyers=False)
    assert ix.candidates(static)["buyer"] == []
    # The monthly record's months join the list pages once the export holds them; a file that names none adds none.
    (static / "monthly").mkdir()
    (static / "monthly" / "index.json").write_text(
        '{"as_of": "2026-11-19", "months": [{"month": "2026-10"}, {"month": "2026-13"}, {"month": 7}, "x"]}', encoding="utf-8")
    pages = ix.candidates(static)["page"]
    assert "/monthly/2026-10" in pages and not any("2026-13" in p for p in pages)
    assert ix.guide_paths(tmp_path / "no-such-file.ts") == []


# -- the requests -------------------------------------------------------------------


def test_each_page_is_one_inspection_of_its_canonical_address_paced_and_kept(tmp_path, world, caplog):
    caplog.set_level("INFO")
    path_of = lambda kind: [p for k, p in ix.draw(ix.candidates(world[0])) if k == kind]  # noqa: E731
    unknown, crawled = path_of("tender")[0], path_of("organization")[0]
    duplicate, gone = path_of("buyer")[0], path_of("buyer")[1]
    http = FakeGoogle({
        unknown: answer("NEUTRAL", "URL is unknown to Google", unknown, fetch="PAGE_FETCH_STATE_UNSPECIFIED", crawl=None),
        crawled: answer("NEUTRAL", "Crawled - currently not indexed", crawled),
        duplicate: answer("NEUTRAL", "Duplicate, Google chose different canonical than user", duplicate,
                          canonical=f"https://www.awardwatch.ca{duplicate}?lang=fr"),
        gone: answer("FAIL", "Not found (404)", gone, fetch="NOT_FOUND", canonical="https://elsewhere.example/x"),
    })
    outcome, sleeps = run(tmp_path, world, http)
    assert outcome == "inspected 40"
    token, *inspections = http.calls
    assert token["url"] == sc.TOKEN_URL and len(inspections) == 40
    for c in inspections:
        assert c["url"] == "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
        assert set(c["json"]) == {"inspectionUrl", "siteUrl", "languageCode"}
        assert c["json"]["siteUrl"] == "sc-domain:awardwatch.ca" and c["json"]["languageCode"] == "en-US"
        assert c["json"]["inspectionUrl"].startswith(f"{SITE}/")
        assert c["headers"]["Authorization"] == "Bearer ya29.test-token"
    # One pause between two requests, never before the first.
    assert sleeps == [ix.PAUSE_S] * 39
    rows = rows_of(tmp_path)
    assert len(rows) == 40 and {r["date"] for r in rows} == {"2026-11-19"}
    by_path = {r["path"]: r for r in rows}
    assert by_path[unknown]["verdict"] == "NEUTRAL" and by_path[unknown]["coverage"] == "URL is unknown to Google"
    assert by_path[unknown]["last_crawl"] == ""
    assert by_path[crawled]["last_crawl"] == "2026-11-17" and by_path[crawled]["robots"] == "ALLOWED"
    assert by_path[duplicate]["google_canonical"] == duplicate
    assert by_path[gone]["fetch"] == "NOT_FOUND" and by_path[gone]["google_canonical"] == "another host"
    assert sum(r["verdict"] == "PASS" for r in rows) == 36
    assert "ya29.test-token" not in caplog.text and KEY_FRAGMENT not in caplog.text
    assert not http.closed  # a session handed in belongs to the caller


def test_a_night_already_sampled_asks_nothing(tmp_path, world):
    assert run(tmp_path, world, FakeGoogle())[0] == "inspected 40"
    before = (tmp_path / "out" / ix.FILE).read_bytes()
    http = FakeGoogle()
    assert run(tmp_path, world, http)[0] == "up to date"
    assert http.calls == [] and (tmp_path / "out" / ix.FILE).read_bytes() == before
    # The next night appends its own.
    assert run(tmp_path, world, FakeGoogle(), now=NOW + timedelta(days=1))[0] == "inspected 40"
    assert [r["date"] for r in rows_of(tmp_path)].count("2026-11-20") == 40


def test_a_refusal_stops_the_sample_and_the_night_goes_on(tmp_path, world, caplog):
    refused = FakeGoogle(default=FakeResponse(403, {"error": {"code": 403, "message": "User does not have sufficient "
                                                                                     "permission for site."}}))
    assert run(tmp_path, world, refused)[0] == "not permitted"
    assert len(refused.calls) == 2  # the token, then the first page; nothing after the refusal
    assert not (tmp_path / "out" / ix.FILE).exists()
    assert "sufficient permission" in caplog.text and "ya29.test-token" not in caplog.text
    limited = FakeGoogle(default=FakeResponse(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED"}}))
    assert run(tmp_path, world, limited)[0] == "rate limited"
    assert len(limited.calls) == 2


def test_a_page_that_fails_is_skipped_and_the_rest_are_kept(tmp_path, world):
    sample = ix.draw(ix.candidates(world[0]))
    broken = {p: FakeResponse(500, None, "backend error") for _, p in sample[:3]}
    broken[sample[3][1]] = {"inspectionResult": {}}  # no index status at all
    broken[sample[4][1]] = ConnectionError("reset")
    assert run(tmp_path, world, FakeGoogle(broken))[0] == "inspected 35"
    assert len(rows_of(tmp_path)) == 35
    everything = FakeGoogle(default=FakeResponse(500, None, "backend error"))
    assert run(tmp_path, world, everything, now=NOW + timedelta(days=1))[0] == "failed"


def test_the_time_budget_ends_the_night(tmp_path, world):
    ticks = iter([0.0] + [0.0] * 5 + [ix.BUDGET_S + 1] * 100)
    outcome, _ = run(tmp_path, world, FakeGoogle(), clock=lambda: next(ticks))
    assert outcome == "inspected 5"
    # The five pages a night cut that short has asked are one of each kind.
    assert sorted(r["kind"] for r in rows_of(tmp_path)) == sorted(k for k, _ in ix.SAMPLE)


def test_what_google_says_is_kept_short_and_plain(tmp_path):
    odd = answer("PASS; DROP", "Submitted and indexed\nInjected: x" + "y" * 400, "/p", crawl="yesterday")
    row = ix.row_of(date(2026, 11, 19), "tender", "/tenders/x", odd, SITE)
    assert row["verdict"] == "" and "\n" not in row["coverage"] and len(row["coverage"]) <= ix.TEXT_MAX
    assert row["last_crawl"] == ""
    assert ix.row_of(date(2026, 11, 19), "tender", "/tenders/x", {"error": "x"}, SITE) is None


def test_without_the_secret_or_a_sample_nothing_is_asked(tmp_path, world):
    http = FakeGoogle()
    assert run(tmp_path, world, http, env={})[0] == "no credentials"
    assert http.calls == []
    outcome = ix.run(tmp_path / "out", env=ENV, session=http, now=NOW, static=tmp_path / "none", db=tmp_path / "none")
    assert outcome == "no sample" and http.calls == []
    stored = tmp_path / "out" / ix.FILE
    stored.write_text("date,kind\n2026-11-18,x\n", encoding="utf-8")
    assert run(tmp_path, world, http)[0] == "failed"
    assert stored.read_text(encoding="utf-8") == "date,kind\n2026-11-18,x\n" and http.calls == []


# -- the command and the run status ---------------------------------------------------


def test_the_command_writes_three_outcomes_and_fails_only_with_the_totals(tmp_path, monkeypatch):
    monkeypatch.delenv(sc.SECRET_ENV, raising=False)
    assert nightly.main(["import-search-console", "--out", str(tmp_path)]) == 0
    for name in ("outcome.txt", "detail_outcome.txt", "index_outcome.txt"):
        assert (tmp_path / name).read_bytes() == b"no credentials\n", name


def test_the_run_status_carries_both_words_and_a_refusal_is_a_notice(tmp_path):
    db = tmp_path / "none.sqlite"
    status = nightly.run_status(db, None, None, {})
    assert (status["search_console_detail"], status["index_sample"]) == ("not run", "not run")
    for word in ("inspected 40", "up to date", "no sample", "no credentials"):
        status = nightly.run_status(db, None, None, {}, index_sample=word, search_detail="imported 1 day")
        assert status["index_sample"] == word and not any(n["source"] in ("index_sample", "search_console_detail")
                                                          for n in status["notices"])
    baseline = nightly.run_status(db, None, None, {})
    for word in ("not permitted", "rate limited", "failed"):
        status = nightly.run_status(db, None, None, {}, index_sample=word)
        assert {"source": "index_sample", "detail": nightly.INDEX_SAMPLE_NOTICES[word]} in status["notices"]
        # A notice only: the run's verdict and its items needing attention are as without it.
        assert status["ok"] == baseline["ok"] and status["stages"] == baseline["stages"]
        assert resilience.attention_items(status) == resilience.attention_items(baseline)
    status = nightly.run_status(db, None, None, {}, search_detail="failed")
    assert {"source": "search_console_detail", "detail": nightly.SEARCH_DETAIL_NOTICE} in status["notices"]
    for notice in (nightly.SEARCH_DETAIL_NOTICE, *nightly.INDEX_SAMPLE_NOTICES.values()):
        for dash in (chr(0x2014), chr(0x2013)):
            assert dash not in notice
    (tmp_path / "index.txt").write_text("not permitted\n", encoding="utf-8")
    (tmp_path / "detail.txt").write_text("imported 3 days\n", encoding="utf-8")
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(db), "--index-sample-outcome", str(tmp_path / "index.txt"),
                         "--search-detail-outcome", str(tmp_path / "detail.txt"), "--out", str(out)]) == 0
    written = json.loads(out.read_text(encoding="utf-8"))
    assert (written["index_sample"], written["search_console_detail"]) == ("not permitted", "imported 3 days")
