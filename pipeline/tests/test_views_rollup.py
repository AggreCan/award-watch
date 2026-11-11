"""The audience roll-up, against a stub session: nothing here reaches the network."""

from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

from awardwatch_pipeline import config, nightly, views_rollup as vr

ACCOUNT = "0123456789abcdef0123456789abcdef"
TOKEN = "analytics-token-value"
ENV = {vr.TOKEN_ENV: TOKEN, vr.ACCOUNT_ENV: ACCOUNT}
NOW = datetime(2026, 10, 22, 0, 40, tzinfo=timezone.utc)
YESTERDAY = date(2026, 10, 21)
START = 1792540800  # 2026-10-21T00:00:00Z


class FakeResponse:
    def __init__(self, status: int, body: object = None, text: str | None = None) -> None:
        self.status_code = status
        self._body = body
        self.text = text if text is not None else json.dumps(body)

    def json(self) -> object:
        if self._body is None:
            raise ValueError("no json")
        return self._body


def answer(rows: list[dict]) -> FakeResponse:
    # The shape the SQL API gives with FORMAT JSON; 64-bit sums come quoted.
    return FakeResponse(200, {"meta": [], "data": rows, "rows": len(rows)})


KINDS = [{"kind": "page", "responses": "120"}, {"kind": "api", "responses": "30"},
         {"kind": "download", "responses": "4"}, {"kind": "form", "responses": "1"},
         {"kind": "feed", "responses": "40"}, {"kind": "hook", "responses": "2"}, {"kind": "other", "responses": "9"}]
COUNTS = [
    {"route": "/organizations/:id", "kind": "page", "lang": "en", "country": "CA", "referrer": "news.example.org",
     "status": 200, "responses": "70"},
    {"route": "/", "kind": "page", "lang": "fr", "country": "CA", "referrer": "", "status": 200, "responses": "50"},
    {"route": "/api/stats", "kind": "api", "lang": "en", "country": "US", "referrer": "", "status": 200, "responses": "30"},
    {"route": "/downloads/organizations.csv", "kind": "download", "lang": "en", "country": "", "referrer": "",
     "status": 200, "responses": "4"},
    {"route": "/corrections", "kind": "form", "lang": "en", "country": "CA", "referrer": "awardwatch.ca",
     "status": 200, "responses": "1"},
    {"route": "/data/feeds/:file", "kind": "feed", "lang": "en", "country": "US", "referrer": "", "status": 200,
     "responses": "36"},
    {"route": "/data/feeds/:file", "kind": "feed", "lang": "en", "country": "US", "referrer": "", "status": 404,
     "responses": "4"},
    {"route": "/hooks/kofi", "kind": "hook", "lang": "en", "country": "", "referrer": "", "status": 200, "responses": "2"},
    {"route": "other", "kind": "other", "lang": "en", "country": "NL", "referrer": "", "status": 404, "responses": "9"},
]
FEEDS = [
    {"feed": "", "responses": "4", "subscribers": 0},
    {"feed": "feeds/canada/tenders.xml", "responses": "30", "subscribers": 12},
    {"feed": "feeds/prov/bc/awards.xml", "responses": "6", "subscribers": 3.0},
]


# What Analytics Engine answers for a day counted before the bot flag: every
# page point has an empty blob8, and no point is a person's.
UNFLAGGED = {
    "audience": [{"agent": "", "country": "CA", "device": "", "lang": "en", "pages": "120"}],
    "routes": [],
    "visitors": [{"visitors": "0", "uncoded": "0"}],
    "visits": [{"visits": "0"}],
}


# The three people counts when a day's answers do not name them: none of each.
NO_PEOPLE = {"engaged": [{"engaged": "0"}], "hosts": [], "search": [{"search": "0"}], "phone": [{"phone": "0"}]}


class FakeHttp:
    """Stands in for requests.Session. Answers the SQL API per day from `days`
    (day -> (kinds, counts, feeds) or (kinds, counts, feeds, audience answers);
    a day not listed has no data points; three answers stand for a day before
    the bot flag). The audience answers may name the people counts' answers
    (engaged, hosts, search, phone; NO_PEOPLE otherwise). `fail` replaces
    every SQL answer. A GET is recorded and answered 404: the roll-up reads
    nothing but the SQL API."""

    def __init__(self, days: dict | None = None, *, fail: FakeResponse | Exception | None = None) -> None:
        self.days = {YESTERDAY: (KINDS, COUNTS, FEEDS)} if days is None else days
        self.fail = fail
        self.posts: list[dict] = []
        self.gets: list[dict] = []
        self.closed = False

    def post(self, url, data=None, headers=None, timeout=None):
        sql = data.decode("utf-8")
        self.posts.append({"url": url, "sql": sql, "headers": headers or {}})
        if isinstance(self.fail, Exception):
            raise self.fail
        if self.fail is not None:
            return self.fail
        # The start bound names the day (its end bound is the next day's start).
        day = next((d for d in self.days if f">= toDateTime({vr.day_bounds(d)[0]})" in sql), None)
        held = self.days.get(day)
        if held is None:
            # No point at all: grouped queries answer no rows, aggregates one row of zeros.
            kinds, counts, feeds, extra = [], [], [], {"audience": [], "routes": [],
                                                       "visitors": [{"visitors": "0", "uncoded": "0"}],
                                                       "visits": [{"visits": "0"}]}
        else:
            kinds, counts, feeds = held[:3]
            extra = held[3] if len(held) > 3 else UNFLAGGED
        extra = {**NO_PEOPLE, **extra}
        if "blob7 AS feed" in sql:
            return answer(feeds)
        if "GROUP BY kind " in sql:
            return answer(kinds)
        if "blob8 AS agent" in sql:
            return answer(extra["audience"])
        if sql.startswith("SELECT count() AS engaged"):
            return answer(extra["engaged"])
        if sql.startswith("SELECT blob5 AS referrer"):
            return answer(extra["hosts"])
        if "AS search " in sql:
            return answer(extra["search"])
        if "AS phone " in sql:
            return answer(extra["phone"])
        if "SUM(_sample_interval) AS pages" in sql:
            return answer(extra["routes"])
        if "AS uncoded" in sql:
            return answer(extra["visitors"])
        if "AS visits" in sql:
            return answer(extra["visits"])
        return answer(counts)

    def get(self, url, headers=None, timeout=None, params=None, auth=None):
        self.gets.append({"url": url, "headers": headers or {}, "params": params, "auth": auth})
        return FakeResponse(404, None, "not found")

    def close(self):
        self.closed = True


def read_csv(path) -> tuple[list[str], list[dict]]:
    reader = csv.DictReader(io.StringIO(path.read_text(encoding="utf-8")))
    return list(reader.fieldnames or []), list(reader)


def roll(tmp_path, http: FakeHttp | None = None, **kw) -> str:
    kw.setdefault("stats_path", tmp_path / "no-stats.json")
    return vr.run(tmp_path, env=kw.pop("env", ENV), session=http if http is not None else FakeHttp(), now=NOW, **kw)


@pytest.fixture(autouse=True)
def site(monkeypatch):
    monkeypatch.setattr(config, "SITE_URL", "https://awardwatch.ca")


# -- SQL ----------------------------------------------------------------------


def test_the_sql_for_a_day_covers_exactly_that_utc_day():
    assert vr.day_bounds(YESTERDAY) == (START, START + 86_400)
    assert vr.counts_sql(YESTERDAY) == (
        "SELECT blob1 AS route, blob2 AS kind, blob3 AS lang, blob4 AS country, blob5 AS referrer, "
        "double1 AS status, SUM(_sample_interval) AS responses FROM awardwatch_views "
        f"WHERE timestamp >= toDateTime({START}) AND timestamp < toDateTime({START + 86_400}) "
        "GROUP BY route, kind, lang, country, referrer, status ORDER BY responses DESC LIMIT 10000 FORMAT JSON"
    )
    assert vr.kinds_sql(YESTERDAY) == (
        "SELECT blob2 AS kind, SUM(_sample_interval) AS responses FROM awardwatch_views "
        f"WHERE timestamp >= toDateTime({START}) AND timestamp < toDateTime({START + 86_400}) "
        "GROUP BY kind ORDER BY kind FORMAT JSON"
    )
    feeds = vr.feeds_sql(YESTERDAY)
    assert "blob7 AS feed" in feeds and "MAX(double2) AS subscribers" in feeds and "blob2 = 'feed'" in feeds
    assert f"toDateTime({START})" in feeds and f"toDateTime({START + 86_400})" in feeds
    # Sampled counts are summed, never counted.
    for sql in (vr.counts_sql(YESTERDAY), vr.kinds_sql(YESTERDAY), feeds):
        assert "COUNT(" not in sql.upper() and "SUM(_sample_interval)" in sql


def test_each_query_is_a_post_with_the_sql_as_body_and_the_token_only_in_the_header(tmp_path):
    http = FakeHttp()
    assert roll(tmp_path, http, day=YESTERDAY) == "rolled up"
    assert [p["sql"] for p in http.posts] == [
        vr.kinds_sql(YESTERDAY), vr.counts_sql(YESTERDAY), vr.feeds_sql(YESTERDAY), vr.audience_sql(YESTERDAY),
        vr.human_routes_sql(YESTERDAY), vr.visitors_sql(YESTERDAY), vr.visits_sql(YESTERDAY)]
    for p in http.posts:
        assert p["url"] == f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/analytics_engine/sql"
        assert p["headers"]["Authorization"] == f"Bearer {TOKEN}"
        assert p["headers"]["User-Agent"] == config.USER_AGENT
        assert TOKEN not in p["url"] and TOKEN not in p["sql"]
    assert not http.closed  # a session handed in belongs to the caller


# -- the files ----------------------------------------------------------------


def test_the_day_file_holds_the_total_the_kinds_every_count_and_every_feed(tmp_path):
    assert roll(tmp_path) == "rolled up"
    header, rows = read_csv(tmp_path / "2026-10-21.csv")
    assert header == vr.DAY_HEADER == ["date", "section", "route", "kind", "lang", "country", "referrer", "status",
                                       "feed", "responses", "subscribers", "agent", "device"]
    assert {r["date"] for r in rows} == {"2026-10-21"}
    sections = [r["section"] for r in rows]
    assert sections == ["total"] + ["kind"] * 7 + ["count"] * 9 + ["feed"] * 3 + ["audience"]
    # A day before the bot flag: its page views are kept, with the agent left empty.
    audience = rows[-1]
    assert (audience["agent"], audience["country"], audience["device"], audience["lang"], audience["responses"]) == (
        "", "CA", "", "en", "120")
    assert rows[0]["responses"] == "206" and rows[0]["route"] == "" and rows[0]["subscribers"] == ""
    assert {r["kind"]: r["responses"] for r in rows if r["section"] == "kind"} == {
        "api": "30", "download": "4", "feed": "40", "form": "1", "hook": "2", "other": "9", "page": "120"}
    first = rows[8]
    assert (first["route"], first["kind"], first["lang"], first["country"], first["referrer"], first["status"],
            first["responses"]) == ("/organizations/:id", "page", "en", "CA", "news.example.org", "200", "70")
    feeds = {r["feed"]: (r["route"], r["kind"], r["responses"], r["subscribers"]) for r in rows if r["section"] == "feed"}
    assert feeds == {
        "": ("/data/feeds/:file", "feed", "4", "0"),
        "feeds/canada/tenders.xml": ("/data/feeds/:file", "feed", "30", "12"),
        "feeds/prov/bc/awards.xml": ("/data/feeds/:file", "feed", "6", "3"),
    }
    assert (tmp_path / vr.ROLLED_UP).read_text(encoding="utf-8") == "2026-10-21\n"
    assert not list(tmp_path.glob("*.partial"))


def test_a_value_the_worker_would_never_write_is_blanked_before_it_is_stored(tmp_path):
    odd = [
        {"route": "/someone@example.com/profile?x=1", "kind": "page", "lang": "de",
         "country": "Canada", "referrer": "https://news.example.org/story?id=7", "status": 200, "responses": "3"},
        {"route": "/", "kind": "Mozilla/5.0 (X11; Linux x86_64)", "lang": "en", "country": "203.0.113.42",
         "referrer": "UPPER.example", "status": "nan", "responses": "2"},
    ]
    feeds = [{"feed": "feeds/../../etc/passwd.xml", "responses": "1", "subscribers": "inf"}]
    kinds = [{"kind": "page", "responses": "5"}]
    assert roll(tmp_path, FakeHttp({YESTERDAY: (kinds, odd, feeds)})) == "rolled up"
    text = (tmp_path / "2026-10-21.csv").read_text(encoding="utf-8")
    for leaked in ("someone@example.com", "?x=1", "Canada", "/story", "id=7", "Mozilla", "203.0.113.42", "UPPER",
                   "passwd", "inf", "nan", "de,"):
        assert leaked not in text, leaked
    _, rows = read_csv(tmp_path / "2026-10-21.csv")
    counts = [(r["route"], r["kind"], r["lang"], r["country"], r["referrer"], r["status"], r["responses"])
              for r in rows if r["section"] == "count"]
    assert counts == [("other", "page", "", "", "", "200", "3"), ("/", "other", "en", "", "", "", "2")]
    assert [(r["feed"], r["subscribers"]) for r in rows if r["section"] == "feed"] == [("", "0")]


def test_the_summary_gets_one_row_per_day_and_a_re_run_replaces_it_in_place(tmp_path):
    summary = tmp_path / vr.SUMMARY
    summary.write_text(
        ",".join(vr.SUMMARY_HEADER) + "\n"
        "2026-10-19,100,80,10,5,1,4,0,6,/ 60\n"
        "2026-10-20,110,90,10,5,1,4,0,6,/ 61\n", encoding="utf-8")
    assert roll(tmp_path) == "rolled up"
    header, rows = read_csv(summary)
    assert header == vr.SUMMARY_HEADER == ["date", "responses", "pages", "api", "downloads", "forms", "feeds", "other",
                                           "feed_subscribers", "top_routes",
                                           "human_pages", "bot_pages", "unique_visitors", "human_visits",
                                           "human_by_country", "human_by_device", "human_by_lang", "human_by_route",
                                           "organizations", "records",
                                           "engaged_visitors", "search_visitors", "phone_visitors"]
    assert [r["date"] for r in rows] == ["2026-10-19", "2026-10-20", "2026-10-21"]
    assert rows[0]["top_routes"] == "/ 60"  # earlier rows are kept as they were
    new = rows[-1]
    assert {k: new[k] for k in vr.SUMMARY_HEADER} == {
        "date": "2026-10-21", "responses": "206", "pages": "120", "api": "30", "downloads": "4", "forms": "1",
        "feeds": "40", "other": "11", "feed_subscribers": "15",
        "top_routes": "/organizations/:id 70; / 50; /data/feeds/:file 36; /api/stats 30; /downloads/organizations.csv 4",
        # A day before the bot flag: blank, never 0.
        **dict.fromkeys(vr.AUDIENCE_COLUMNS, ""),
        # No stats.json in this test.
        "organizations": "", "records": "",
    }
    assert rows[0]["human_pages"] == "" and rows[0]["unique_visitors"] == ""  # older rows read with blanks

    # The same night again (a manual re-run): still one row for the day.
    assert roll(tmp_path, FakeHttp()) == "rolled up"
    _, rows = read_csv(summary)
    assert [r["date"] for r in rows] == ["2026-10-19", "2026-10-20", "2026-10-21"]
    assert rows[-1]["responses"] == "206"


def test_a_summary_that_cannot_be_read_safely_is_never_replaced(tmp_path):
    summary = tmp_path / vr.SUMMARY
    bad = [
        "",  # an empty download
        "date,responses,visitors_ip\n2026-10-20,5,x\n",  # a column this code does not know
        ",".join(vr.SUMMARY_HEADER) + "\nnot-a-date,1,1,0,0,0,0,0,0,,\n",
        ",".join(vr.SUMMARY_HEADER) + "\n2026-13-45,1,1,0,0,0,0,0,0,,\n",
        ",".join(vr.SUMMARY_HEADER) + "\n2026-10-20" + ",1" * (len(vr.SUMMARY_HEADER) - 1) + ",extra\n",  # one field too many
    ]
    for text in bad:
        summary.write_text(text, encoding="utf-8")
        http = FakeHttp()
        assert roll(tmp_path, http) == "failed", text
        assert summary.read_text(encoding="utf-8") == text
        assert http.posts == []
        assert not (tmp_path / "2026-10-21.csv").exists()
        assert (tmp_path / vr.ROLLED_UP).read_text(encoding="utf-8") == ""


# -- outcomes -----------------------------------------------------------------


def test_without_a_token_nothing_is_asked_and_nothing_written(tmp_path, caplog):
    (tmp_path / vr.ROLLED_UP).write_text("2026-10-01\n", encoding="utf-8")  # left by an earlier run
    http = FakeHttp()
    caplog.set_level("INFO")
    assert roll(tmp_path, http, env={vr.ACCOUNT_ENV: ACCOUNT}) == "no token"
    assert roll(tmp_path, http, env={vr.TOKEN_ENV: "  ", vr.ACCOUNT_ENV: ACCOUNT}) == "no token"
    assert "no analytics token; nothing rolled up" in caplog.text
    assert http.posts == [] and http.gets == []
    assert (tmp_path / vr.ROLLED_UP).read_text(encoding="utf-8") == ""
    assert not (tmp_path / vr.SUMMARY).exists()


@pytest.mark.parametrize("fail", [
    FakeResponse(500, None, "internal error"),
    FakeResponse(401, {"errors": [{"message": "Authentication error"}]}),
    FakeResponse(200, {"errors": []}),  # no rows
    FakeResponse(200, {"data": "not rows"}),
    FakeResponse(200, None, "<html>"),
    requests.ConnectionError("connection reset"),
])
def test_an_api_failure_is_failed_and_leaves_every_file_as_it_was(tmp_path, fail, caplog):
    summary = tmp_path / vr.SUMMARY
    summary.write_text(",".join(vr.SUMMARY_HEADER) + "\n2026-10-20,1,1,0,0,0,0,0,0,,/ 1\n", encoding="utf-8")
    before = summary.read_text(encoding="utf-8")
    assert roll(tmp_path, FakeHttp(fail=fail)) == "failed"
    assert summary.read_text(encoding="utf-8") == before
    assert not (tmp_path / "2026-10-21.csv").exists()
    assert (tmp_path / vr.ROLLED_UP).read_text(encoding="utf-8") == ""
    assert TOKEN not in caplog.text


def test_the_log_names_the_day_and_its_file_and_never_a_figure(tmp_path, caplog, capsys):
    # The run log is public: the counts go to the files, never to the log.
    caplog.set_level("INFO")
    kinds = [{"kind": "page", "responses": "73011"}, {"kind": "api", "responses": "73012"}]
    counts = [{"route": "/", "kind": "page", "lang": "en", "country": "CA", "referrer": "", "status": 200,
               "responses": "73013"}]
    feeds = [{"feed": "feeds/canada/tenders.xml", "responses": "73014", "subscribers": 73015}]
    people = {**FLAGGED, "audience": [{"agent": "human", "country": "CA", "device": "desktop", "lang": "en",
                                       "pages": "73016"}],
              "routes": [{"route": "/", "pages": "73016"}], "visitors": [{"visitors": "73017", "uncoded": "0"}],
              "visits": [{"visits": "73018"}], "engaged": [{"engaged": "73019"}], "search": [{"search": "73020"}],
              "phone": [{"phone": "73021"}]}
    before = date(2026, 10, 20)
    http = FakeHttp({before: (kinds, counts, feeds), YESTERDAY: (kinds, counts, feeds, people)})
    (tmp_path / vr.SUMMARY).write_text(",".join(vr.SUMMARY_HEADER) + "\n2026-10-19,1,1,0,0,0,0,0,0,,/ 1\n",
                                       encoding="utf-8")
    assert roll(tmp_path, http) == "rolled up"
    assert "73013" in (tmp_path / "2026-10-21.csv").read_text(encoding="utf-8")
    days = [r.getMessage() for r in caplog.records if r.getMessage().startswith("views: 2026-10-2")]
    assert days == ["views: 2026-10-20 rolled up (no bot flag, people columns blank) -> 2026-10-20.csv",
                    "views: 2026-10-21 rolled up -> 2026-10-21.csv"]
    shown = caplog.text + capsys.readouterr().err
    for n in [*range(73011, 73022), 73011 + 73012]:
        assert str(n) not in shown and f"{n:,}" not in shown, n
    # A successful answer that does not read is reported without its body, which may hold the counts.
    caplog.clear()
    bad = FakeResponse(200, None, '{"meta": [], "data": [{"kind": "page", "responses": "73022"')
    assert roll(tmp_path, FakeHttp(fail=bad)) == "failed"
    assert "HTTP 200 without rows" in caplog.text and "73022" not in caplog.text


def test_a_failure_part_way_through_a_catch_up_writes_nothing(tmp_path):
    summary = tmp_path / vr.SUMMARY
    summary.write_text(",".join(vr.SUMMARY_HEADER) + "\n2026-10-19,1,1,0,0,0,0,0,0,,/ 1\n", encoding="utf-8")

    class FailsLater(FakeHttp):
        def post(self, url, data=None, headers=None, timeout=None):
            if len(self.posts) >= 3:
                self.posts.append({"url": url, "sql": data.decode(), "headers": headers})
                return FakeResponse(502, None, "bad gateway")
            return super().post(url, data=data, headers=headers, timeout=timeout)

    days = {date(2026, 10, 20): (KINDS, COUNTS, FEEDS), YESTERDAY: (KINDS, COUNTS, FEEDS)}
    assert roll(tmp_path, FailsLater(days)) == "failed"
    assert not list(tmp_path.glob("2026-*.csv"))
    assert summary.read_text(encoding="utf-8").count("\n") == 2


def test_missing_days_are_caught_up_and_empty_days_are_not_written(tmp_path):
    summary = tmp_path / vr.SUMMARY
    summary.write_text(",".join(vr.SUMMARY_HEADER) + "\n2026-10-17,1,1,0,0,0,0,0,0,,/ 1\n", encoding="utf-8")
    days = {date(2026, 10, 18): (KINDS, COUNTS, FEEDS), YESTERDAY: (KINDS, COUNTS, FEEDS)}
    http = FakeHttp(days)
    assert roll(tmp_path, http) == "rolled up"
    asked = [p["sql"] for p in http.posts if "GROUP BY kind " in p["sql"]]
    assert asked == [vr.kinds_sql(date(2026, 10, d)) for d in (18, 19, 20, 21)]
    # An empty day costs one question, not seven.
    assert len(http.posts) == 4 + 2 * 6
    assert sorted(p.name for p in tmp_path.glob("2026-*.csv")) == ["2026-10-18.csv", "2026-10-21.csv"]
    assert (tmp_path / vr.ROLLED_UP).read_text(encoding="utf-8") == "2026-10-18\n2026-10-21\n"
    _, rows = read_csv(summary)
    assert [r["date"] for r in rows] == ["2026-10-17", "2026-10-18", "2026-10-21"]
    assert http.gets == []  # nothing is read but the SQL API


def test_the_first_night_asks_for_all_three_months_analytics_engine_keeps(tmp_path):
    early = date(2026, 10, 9)
    http = FakeHttp({early: (KINDS, COUNTS, FEEDS), YESTERDAY: (KINDS, COUNTS, FEEDS)})
    assert roll(tmp_path, http) == "rolled up"
    asked = [p["sql"] for p in http.posts if "GROUP BY kind " in p["sql"]]
    assert len(asked) == vr.RETENTION_DAYS
    assert asked[0] == vr.kinds_sql(YESTERDAY - timedelta(days=vr.RETENTION_DAYS - 1))
    assert asked[-1] == vr.kinds_sql(YESTERDAY)
    _, rows = read_csv(tmp_path / vr.SUMMARY)
    assert [r["date"] for r in rows] == ["2026-10-09", "2026-10-21"]


def test_days_due():
    assert vr.days_to_roll(["2026-10-20"], YESTERDAY) == [YESTERDAY]
    # Already rolled up tonight: yesterday again, in place.
    assert vr.days_to_roll(["2026-10-19", "2026-10-21"], YESTERDAY) == [YESTERDAY]
    assert vr.days_to_roll(["2026-10-18"], YESTERDAY) == [date(2026, 10, 19), date(2026, 10, 20), YESTERDAY]
    # Never further back than the retention, however old the newest row.
    long_ago = vr.days_to_roll(["2025-01-01"], YESTERDAY)
    assert len(long_ago) == vr.RETENTION_DAYS and long_ago[-1] == YESTERDAY


def test_no_data_points_at_all_is_no_data(tmp_path):
    http = FakeHttp({})
    assert vr.run(tmp_path, day=YESTERDAY, env=ENV, session=http, now=NOW) == "no data"
    assert len(http.posts) == 1
    assert not (tmp_path / vr.SUMMARY).exists()
    assert (tmp_path / vr.ROLLED_UP).read_text(encoding="utf-8") == ""


def test_a_day_asked_for_by_hand_must_be_over_and_still_held(tmp_path):
    for day in (NOW.date(), NOW.date() + timedelta(days=3), YESTERDAY - timedelta(days=vr.RETENTION_DAYS)):
        http = FakeHttp()
        assert vr.run(tmp_path, day=day, env=ENV, session=http, now=NOW) == "failed", day
        assert http.posts == []
    oldest = YESTERDAY - timedelta(days=vr.RETENTION_DAYS - 1)
    http = FakeHttp({oldest: (KINDS, COUNTS, FEEDS)})
    assert vr.run(tmp_path, day=oldest, env=ENV, session=http, now=NOW) == "rolled up"
    assert (tmp_path / f"{oldest.isoformat()}.csv").exists()
    assert http.gets == []


def test_a_malformed_account_id_is_failed_before_any_request(tmp_path):
    http = FakeHttp()
    assert roll(tmp_path, http, env={vr.TOKEN_ENV: TOKEN, vr.ACCOUNT_ENV: "abc/../../zones"}) == "failed"
    assert roll(tmp_path, http, env={vr.TOKEN_ENV: TOKEN}) == "failed"
    assert http.posts == []


# -- the command and the run status -------------------------------------------


def test_the_command_exits_1_only_when_the_roll_up_failed(tmp_path, monkeypatch):
    monkeypatch.delenv(vr.TOKEN_ENV, raising=False)
    assert nightly.main(["rollup-views", "--out", str(tmp_path)]) == 0

    fake = FakeHttp(fail=FakeResponse(500, None, "boom"))
    monkeypatch.setattr(requests, "Session", lambda: fake)
    monkeypatch.setenv(vr.TOKEN_ENV, TOKEN)
    monkeypatch.setenv(vr.ACCOUNT_ENV, ACCOUNT)
    assert nightly.main(["rollup-views", "--out", str(tmp_path)]) == 1
    assert fake.closed and fake.posts

    good = FakeHttp({date(2026, 9, 1): (KINDS, COUNTS, FEEDS)})
    monkeypatch.setattr(requests, "Session", lambda: good)
    monkeypatch.setattr(vr, "previous_day", lambda now=None: date(2026, 9, 2))
    assert nightly.main(["rollup-views", "--out", str(tmp_path), "--day", "2026-09-01"]) == 0
    assert (tmp_path / "2026-09-01.csv").exists()


def test_the_run_status_carries_the_roll_up(tmp_path):
    db = tmp_path / "none.sqlite"
    assert nightly.run_status(db, None, None, {}, views="failed")["views_rollup"] == "failed"
    assert nightly.run_status(db, None, None, {})["views_rollup"] == "not run"
    (tmp_path / "views.txt").write_text("no token\n", encoding="utf-8")
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(db), "--views-outcome", str(tmp_path / "views.txt"),
                         "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["views_rollup"] == "no token"


# -- people and bots (the bot flag and the visitor code, since 2026-10-30) -----

AUDIENCE = [
    {"agent": "human", "country": "CA", "device": "desktop", "lang": "en", "pages": "60"},
    {"agent": "human", "country": "CA", "device": "mobile", "lang": "fr", "pages": "20"},
    {"agent": "human", "country": "US", "device": "mobile", "lang": "en", "pages": "10"},
    {"agent": "human", "country": "", "device": "tablet", "lang": "en", "pages": "2"},
    {"agent": "bot", "country": "US", "device": "", "lang": "en", "pages": "300"},
]
ROUTES = [{"route": "/organizations/:id", "pages": "70"}, {"route": "/", "pages": "22"}]
# People's referring hosts: two search engines, the site itself, and hosts that only look like one.
HOSTS = [{"referrer": "awardwatch.ca", "pages": "40"}, {"referrer": "www.google.com", "pages": "9"},
         {"referrer": "www.bing.com", "pages": "2"}, {"referrer": "notgoogle.example", "pages": "4"},
         {"referrer": "news.google.com", "pages": "2"}]
FLAGGED = {"audience": AUDIENCE, "routes": ROUTES, "visitors": [{"visitors": "41", "uncoded": "0"}],
           "visits": [{"visits": "37"}], "engaged": [{"engaged": "7"}], "hosts": HOSTS,
           "search": [{"search": "9"}], "phone": [{"phone": "6"}]}


def flagged_day(**changes) -> dict:
    return {date(2026, 10, 21): (KINDS, COUNTS, FEEDS, {**FLAGGED, **changes})}


def summary_last(folder) -> dict:
    _, rows = read_csv(folder / vr.SUMMARY)
    return rows[-1]


def test_the_people_and_bot_queries_read_page_views_below_400_and_only_count_codes():
    where = f"timestamp >= toDateTime({START}) AND timestamp < toDateTime({START + 86_400})"
    assert vr.audience_sql(YESTERDAY) == (
        "SELECT blob8 AS agent, blob4 AS country, blob9 AS device, blob3 AS lang, SUM(_sample_interval) AS pages "
        f"FROM awardwatch_views WHERE blob2 = 'page' AND double1 < 400 AND {where} "
        "GROUP BY agent, country, device, lang ORDER BY pages DESC LIMIT 10000 FORMAT JSON")
    assert vr.human_routes_sql(YESTERDAY) == (
        "SELECT blob1 AS route, SUM(_sample_interval) AS pages FROM awardwatch_views "
        f"WHERE blob2 = 'page' AND double1 < 400 AND blob8 = 'human' AND {where} "
        "GROUP BY route ORDER BY pages DESC LIMIT 10000 FORMAT JSON")
    assert vr.visitors_sql(YESTERDAY) == (
        "SELECT count(DISTINCT blob10) AS visitors, sumIf(_sample_interval, blob10 = '') AS uncoded "
        f"FROM awardwatch_views WHERE blob8 = 'human' AND {where} FORMAT JSON")
    assert vr.visits_sql(YESTERDAY) == (
        "SELECT count(DISTINCT blob10) AS visits FROM awardwatch_views "
        f"WHERE blob8 = 'human' AND blob2 = 'page' AND blob10 != '' AND {where} FORMAT JSON")
    # No query ever reads a visitor code back: blob10 appears only inside a
    # distinct count or a comparison with the empty string, or inside the
    # engaged count's inner query, whose outer query answers one number.
    for sql in every_query(YESTERDAY):
        if sql.startswith("SELECT count() AS engaged FROM (SELECT blob10 AS code,"):
            assert sql.endswith(" HAVING n >= 2) FORMAT JSON"), sql
            sql = sql.replace("SELECT blob10 AS code,", "SELECT").replace("GROUP BY code", "")
        rest = sql.replace("count(DISTINCT blob10)", "").replace("blob10 = ''", "").replace("blob10 != ''", "")
        assert "blob10" not in rest, sql


def every_query(day: date) -> list[str]:
    """Every query the roll-up can send for a day."""
    return [vr.kinds_sql(day), vr.counts_sql(day), vr.feeds_sql(day), vr.audience_sql(day), vr.human_routes_sql(day),
            vr.visitors_sql(day), vr.visits_sql(day), vr.engaged_sql(day), vr.search_hosts_sql(day),
            vr.search_sql(day, ["www.google.ca", "www.bing.com"]), vr.phone_sql(day)]


def test_a_flagged_day_fills_the_people_and_bot_columns(tmp_path):
    assert roll(tmp_path, FakeHttp(flagged_day())) == "rolled up"
    row = summary_last(tmp_path)
    assert {k: row[k] for k in vr.AUDIENCE_COLUMNS} == {
        "human_pages": "92", "bot_pages": "300", "unique_visitors": "41", "human_visits": "37",
        "human_by_country": '{"CA":80,"US":10,"unknown":2}',
        "human_by_device": '{"desktop":60,"mobile":30,"tablet":2}',
        "human_by_lang": '{"en":72,"fr":20}',
        "human_by_route": '{"/organizations/:id":70,"/":22}',
        "engaged_visitors": "7", "search_visitors": "9", "phone_visitors": "6",
    }
    # The existing columns are unchanged by the flag.
    assert (row["responses"], row["pages"]) == ("206", "120")
    _, rows = read_csv(tmp_path / "2026-10-21.csv")
    audience = [(r["agent"], r["country"], r["device"], r["lang"], r["responses"]) for r in rows if r["section"] == "audience"]
    assert audience == [("bot", "US", "", "en", "300"), ("human", "CA", "desktop", "en", "60"),
                        ("human", "CA", "mobile", "fr", "20"), ("human", "US", "mobile", "en", "10"),
                        ("human", "", "tablet", "en", "2")]


def test_the_country_column_keeps_the_top_ten_and_sums_the_rest():
    rows = [{"agent": "human", "country": f"A{chr(65 + i)}", "device": "desktop", "lang": "en", "pages": str(100 - i)}
            for i in range(12)]
    d = vr.build_day(YESTERDAY, KINDS, COUNTS, FEEDS, audience=rows, human_routes=[],
                     visitors=[{"visitors": 5, "uncoded": 0}], visits=[{"visits": 5}])
    columns = vr.audience_columns(d)
    by_country = json.loads(columns["human_by_country"])
    assert list(by_country) == [f"A{chr(65 + i)}" for i in range(10)] + ["other"]
    assert by_country["other"] == 90 + 89
    assert sum(by_country.values()) == columns["human_pages"]


def test_a_day_with_any_page_view_lacking_the_flag_is_blank_never_zero(tmp_path):
    # The day the flag was deployed: points from before it carry no agent.
    mixed = AUDIENCE + [{"agent": "", "country": "CA", "device": "", "lang": "en", "pages": "5"}]
    assert roll(tmp_path, FakeHttp(flagged_day(audience=mixed))) == "rolled up"
    assert all(summary_last(tmp_path)[k] == "" for k in vr.AUDIENCE_COLUMNS)
    # A value the Worker would never write is no flag either.
    odd = [dict(AUDIENCE[0], agent="robot")] + AUDIENCE[1:]
    assert roll(tmp_path, FakeHttp(flagged_day(audience=odd))) == "rolled up"
    assert all(summary_last(tmp_path)[k] == "" for k in vr.AUDIENCE_COLUMNS)


def test_a_day_with_a_person_without_a_code_has_blank_visitor_columns(tmp_path):
    # VIEWS_SALT_KEY not set (every request uncoded), or set part way through the
    # day, or an answer that cannot be read.
    for visitors in ([{"visitors": "1", "uncoded": "92"}], [{"visitors": "30", "uncoded": "4"}],
                     [], [{"visitors": None, "uncoded": "0"}], [{"visitors": "x", "uncoded": "0"}],
                     [{"visitors": "3"}]):
        assert roll(tmp_path, FakeHttp(flagged_day(visitors=visitors))) == "rolled up", visitors
        row = summary_last(tmp_path)
        assert (row["unique_visitors"], row["human_visits"]) == ("", ""), visitors
        assert (row["human_pages"], row["bot_pages"]) == ("92", "300"), visitors


def test_values_the_worker_would_never_write_are_cleaned_before_they_are_stored(tmp_path):
    odd = [{"agent": "human", "country": "Canada", "device": "Mozilla/5.0 (X11)", "lang": "de", "pages": "4"},
           {"agent": "human", "country": "CA", "device": "desktop", "lang": "en", "pages": "6"}]
    routes = [{"route": "/someone@example.com", "pages": "4"}, {"route": "/", "pages": "6"}]
    assert roll(tmp_path, FakeHttp(flagged_day(audience=odd, routes=routes))) == "rolled up"
    row = summary_last(tmp_path)
    assert row["human_by_country"] == '{"CA":6,"unknown":4}'
    assert row["human_by_device"] == '{"desktop":6,"unknown":4}'
    assert row["human_by_lang"] == '{"en":6,"unknown":4}'
    assert row["human_by_route"] == '{"/":6,"other":4}'
    text = (tmp_path / "2026-10-21.csv").read_text(encoding="utf-8") + (tmp_path / vr.SUMMARY).read_text(encoding="utf-8")
    for leaked in ("Canada", "Mozilla", "someone@example.com", ",de,"):
        assert leaked not in text, leaked


# -- readings taken on the night -----------------------------------------------


def test_the_site_counts_come_from_tonights_stats_and_go_on_yesterdays_row_only(tmp_path):
    stats = tmp_path / "stats.json"
    stats.write_text(json.dumps({"counts": {"organizations": 91234, "awards": 60000, "history": 300000,
                                            "contracts": 1100000, "grants": 400000, "lobbying": 150000,
                                            "tenders_open": 1200}}), encoding="utf-8")
    days = {date(2026, 10, 20): (KINDS, COUNTS, FEEDS, FLAGGED), YESTERDAY: (KINDS, COUNTS, FEEDS, FLAGGED)}
    summary = tmp_path / vr.SUMMARY
    # A summary written before the newer columns.
    summary.write_text(",".join(vr.SUMMARY_HEADER[:10]) + "\n2026-10-19,1,1,0,0,0,0,0,0,/ 1\n", encoding="utf-8")
    assert roll(tmp_path, FakeHttp(days), stats_path=stats) == "rolled up"
    _, rows = read_csv(summary)
    assert [(r["date"], r["organizations"], r["records"]) for r in rows] == [
        ("2026-10-19", "", ""), ("2026-10-20", "", ""), ("2026-10-21", "91234", "2010000")]

    # Rolled up again without a readable stats file: the readings stay.
    assert roll(tmp_path, FakeHttp(days), stats_path=tmp_path / "gone.json") == "rolled up"
    row = summary_last(tmp_path)
    assert (row["organizations"], row["records"]) == ("91234", "2010000")

    assert vr.site_counts(tmp_path / "gone.json") == {}
    whole = {"organizations": 1, "awards": 1, "history": 1, "contracts": 1, "grants": 1, "lobbying": 1}
    for bad in (json.dumps({"counts": {**whole, "organizations": "1"}}), json.dumps({"counts": {**whole, "grants": -1}}),
                "[]", "not json", '{"counts": {"organizations": 1}}'):
        stats.write_text(bad, encoding="utf-8")
        assert vr.site_counts(stats) == {}, bad


# -- the reader columns: engaged, from search, phone (since 2026-11-11) ---------


def test_the_three_people_queries_count_codes_over_coded_page_views_below_400():
    where = f"timestamp >= toDateTime({START}) AND timestamp < toDateTime({START + 86_400})"
    coded = f"blob8 = 'human' AND blob2 = 'page' AND double1 < 400 AND blob10 != '' AND {where}"
    # The form run against the live dataset: the inner query groups by code, the answer is how many groups.
    assert vr.engaged_sql(YESTERDAY) == (
        "SELECT count() AS engaged FROM (SELECT blob10 AS code, SUM(_sample_interval) AS n "
        f"FROM awardwatch_views WHERE {coded} GROUP BY code HAVING n >= 2) FORMAT JSON")
    assert vr.search_hosts_sql(YESTERDAY) == (
        "SELECT blob5 AS referrer, SUM(_sample_interval) AS pages FROM awardwatch_views "
        f"WHERE blob8 = 'human' AND blob2 = 'page' AND double1 < 400 AND blob5 != '' AND {where} "
        "GROUP BY referrer ORDER BY pages DESC LIMIT 10000 FORMAT JSON")
    assert vr.search_sql(YESTERDAY, ["www.google.ca", "www.google.com"]) == (
        "SELECT count(DISTINCT blob10) AS search FROM awardwatch_views "
        f"WHERE {coded} AND blob5 IN ('www.google.ca', 'www.google.com') FORMAT JSON")
    assert vr.phone_sql(YESTERDAY) == (
        "SELECT count(DISTINCT blob10) AS phone FROM awardwatch_views "
        f"WHERE {coded} AND blob9 IN ('mobile', 'tablet') FORMAT JSON")
    # Forms the SQL API refused in testing, and a backslash, which it takes in no string.
    for sql in every_query(YESTERDAY):
        for refused in ("countIf(DISTINCT", "uniqIf", "toDate(", "IF(", "\\"):
            assert refused not in sql, (refused, sql)


def test_the_search_host_matcher_matches_engines_and_not_names_that_contain_them():
    for host in ("google.ca", "www.google.com", "www.google.co.uk", "www.google.com.hk", "www.bing.com", "bing.com",
                 "cn.bing.com", "duckduckgo.com", "html.duckduckgo.com", "search.yahoo.com", "ca.search.yahoo.com",
                 "www.ecosia.org", "search.brave.com", "www.startpage.com", "www.qwant.com", "yandex.ru",
                 "www.yandex.com.tr", "www.baidu.com", "m.baidu.com"):
        assert vr.is_search_host(host), host
    for host in ("notgoogle.example", "google.example", "news.google.com", "mail.google.com", "google.ca.evil.org",
                 "notbing.com", "bing.com.evil.org", "yahoo.com", "ca.yahoo.com", "brave.com", "awardwatch.ca",
                 "GOOGLE.CA", "google.ca\n", "www.google.ca'", "", None, 7):
        assert not vr.is_search_host(host), host
    # One named list, read by the matcher: an engine added there is matched.
    assert "google.*" in vr.SEARCH_ENGINES and "bing.com" in vr.SEARCH_ENGINES


def test_the_search_hosts_of_a_day_are_the_engines_alone_and_none_when_the_list_may_be_short():
    assert vr.search_hosts(HOSTS) == ["www.bing.com", "www.google.com"]
    assert vr.search_hosts([{"referrer": "awardwatch.ca", "pages": "5"}]) == []
    assert vr.search_hosts([]) == []
    # An answer that filled MAX_ROWS may lack some hosts: not counted rather than an undercount.
    full = [{"referrer": f"site{i}.example", "pages": "1"} for i in range(vr.MAX_ROWS)]
    assert vr.search_hosts(full) is None
    # Forged referrers naming hundreds of engine hosts: not counted.
    forged = [{"referrer": f"www.google.{a}{b}", "pages": "1"} for a in "abcdefghijklmnop" for b in "abcdefghijklmnop"]
    assert vr.search_hosts(forged) is None


def test_a_coded_day_asks_the_three_counts_and_fills_the_columns(tmp_path):
    http = FakeHttp(flagged_day())
    assert roll(tmp_path, http) == "rolled up"
    asked = [p["sql"] for p in http.posts]
    assert asked[-4:] == [vr.engaged_sql(YESTERDAY), vr.search_hosts_sql(YESTERDAY),
                          vr.search_sql(YESTERDAY, ["www.bing.com", "www.google.com"]), vr.phone_sql(YESTERDAY)]
    row = summary_last(tmp_path)
    assert (row["engaged_visitors"], row["search_visitors"], row["phone_visitors"]) == ("7", "9", "6")
    assert (row["unique_visitors"], row["human_visits"]) == ("41", "37")


def test_with_no_search_engine_among_the_hosts_from_search_is_0_without_a_query(tmp_path):
    http = FakeHttp(flagged_day(hosts=[{"referrer": "awardwatch.ca", "pages": "40"}]))
    assert roll(tmp_path, http) == "rolled up"
    assert not any(" AS search " in p["sql"] for p in http.posts)
    assert summary_last(tmp_path)["search_visitors"] == "0"


def test_the_reader_columns_follow_the_visitor_columns_blank_rule(tmp_path):
    # A day before the bot flag, or one with any person's request uncoded: blank, and not asked.
    for days in ({YESTERDAY: (KINDS, COUNTS, FEEDS)}, flagged_day(visitors=[{"visitors": "30", "uncoded": "4"}])):
        http = FakeHttp(days)
        assert roll(tmp_path, http) == "rolled up"
        assert [summary_last(tmp_path)[c] for c in vr.READER_COLUMNS] == ["", "", ""]
        assert not any(p["sql"].startswith("SELECT count() AS engaged") or " AS phone " in p["sql"] for p in http.posts)
    # A count whose answer cannot be read is blank on its own; the others stand.
    assert roll(tmp_path, FakeHttp(flagged_day(engaged=[], phone=[{"phone": "x"}]))) == "rolled up"
    row = summary_last(tmp_path)
    assert (row["engaged_visitors"], row["search_visitors"], row["phone_visitors"]) == ("", "9", "")
    # Hosts that filled a whole answer: from search blank, never an undercount.
    full = [{"referrer": f"site{i}.example", "pages": "1"} for i in range(vr.MAX_ROWS)]
    assert roll(tmp_path, FakeHttp(flagged_day(hosts=full))) == "rolled up"
    row = summary_last(tmp_path)
    assert (row["engaged_visitors"], row["search_visitors"], row["phone_visitors"]) == ("7", "", "6")
    # A 0 stays a 0.
    assert roll(tmp_path, FakeHttp(flagged_day(engaged=[{"engaged": "0"}], phone=[{"phone": 0}]))) == "rolled up"
    row = summary_last(tmp_path)
    assert (row["engaged_visitors"], row["phone_visitors"]) == ("0", "0")


def test_a_failed_people_query_fails_the_night_like_any_other(tmp_path):
    class FailsOnPhone(FakeHttp):
        def post(self, url, data=None, headers=None, timeout=None):
            if " AS phone " in data.decode("utf-8"):
                self.posts.append({"url": url, "sql": data.decode(), "headers": headers})
                return FakeResponse(502, None, "bad gateway")
            return super().post(url, data=data, headers=headers, timeout=timeout)

    assert roll(tmp_path, FailsOnPhone(flagged_day())) == "failed"
    assert not (tmp_path / vr.SUMMARY).exists() and not (tmp_path / "2026-10-21.csv").exists()


# -- the reader columns' catch-up ------------------------------------------------


def held_row(day: str, visits: str = "37", **values) -> dict:
    """A summary row from a coded day rolled up before the reader columns."""
    row = dict.fromkeys(vr.SUMMARY_HEADER, "")
    row.update(date=day, responses="206", pages="120", api="30", downloads="4", forms="1", feeds="40", other="11",
               feed_subscribers="15", top_routes="/ 50", human_pages="92", bot_pages="300", unique_visitors="41",
               human_visits=visits, human_by_country='{"CA":92}', human_by_device='{"desktop":92}',
               human_by_lang='{"en":92}', human_by_route='{"/":92}', organizations="91234", records="2010000")
    row.update(values)
    return row


def write_summary(folder, rows: list[dict]) -> None:
    vr._write_csv(folder / vr.SUMMARY, vr.SUMMARY_HEADER, rows)


def catch_up_world(*days: date, **changes) -> dict:
    """Yesterday flagged, and the earlier days held in the dataset as they were counted."""
    return {YESTERDAY: (KINDS, COUNTS, FEEDS, FLAGGED),
            **{d: (KINDS, COUNTS, FEEDS, {**FLAGGED, **changes}) for d in days}}


def asked_for(http: FakeHttp, day: date) -> list[str]:
    return [p["sql"] for p in http.posts if f">= toDateTime({vr.day_bounds(day)[0]})" in p["sql"]]


def test_the_catch_up_fills_a_held_day_once_and_leaves_the_rest_of_its_row_alone(tmp_path):
    earlier = date(2026, 10, 19)
    write_summary(tmp_path, [held_row("2026-10-19"), held_row("2026-10-20", engaged_visitors="3",
                                                              search_visitors="2", phone_visitors="1")])
    http = FakeHttp(catch_up_world(earlier, date(2026, 10, 20)))
    assert roll(tmp_path, http) == "rolled up"
    # The visits again first, then the three counts.
    assert asked_for(http, earlier) == [vr.visits_sql(earlier), vr.engaged_sql(earlier), vr.search_hosts_sql(earlier),
                                        vr.search_sql(earlier, ["www.bing.com", "www.google.com"]),
                                        vr.phone_sql(earlier)]
    # A day already filled is never asked.
    assert asked_for(http, date(2026, 10, 20)) == []
    _, rows = read_csv(tmp_path / vr.SUMMARY)
    assert [r["date"] for r in rows] == ["2026-10-19", "2026-10-20", "2026-10-21"]
    assert rows[0] == {**held_row("2026-10-19"), "engaged_visitors": "7", "search_visitors": "9",
                       "phone_visitors": "6"}
    assert (rows[1]["engaged_visitors"], rows[1]["search_visitors"], rows[1]["phone_visitors"]) == ("3", "2", "1")
    # Only the night's own day goes to the upload loop; the held day's file is not rewritten.
    assert (tmp_path / vr.ROLLED_UP).read_text(encoding="utf-8") == "2026-10-21\n"
    assert not (tmp_path / "2026-10-19.csv").exists()

    # The next night: the held day is filled, so it is not asked again.
    http = FakeHttp(catch_up_world(earlier))
    assert roll(tmp_path, http) == "rolled up"
    assert asked_for(http, earlier) == []
    assert read_csv(tmp_path / vr.SUMMARY)[1][0]["engaged_visitors"] == "7"


def test_the_catch_up_leaves_a_day_alone_when_the_dataset_answers_for_it_differently(tmp_path):
    earlier = date(2026, 10, 19)
    # Analytics Engine has begun to drop the day: fewer codes with a page view than were counted.
    write_summary(tmp_path, [held_row("2026-10-19", visits="40")])
    http = FakeHttp(catch_up_world(earlier))
    assert roll(tmp_path, http) == "rolled up"
    assert asked_for(http, earlier) == [vr.visits_sql(earlier)]
    held = read_csv(tmp_path / vr.SUMMARY)[1][0]
    assert [held[c] for c in vr.READER_COLUMNS] == ["", "", ""]


def test_the_catch_up_asks_only_days_counted_with_codes_and_still_held(tmp_path):
    rows = [
        held_row("2026-07-20"),                                     # older than the retention
        held_row("2026-10-12", unique_visitors="", human_visits=""),  # before the visitor code
        held_row("2026-10-13", human_visits=""),                    # visits not read when rolled up
        held_row("2026-10-14", unique_visitors="0", human_visits="0"),  # counted, nobody came
    ]
    write_summary(tmp_path, rows)
    http = FakeHttp(catch_up_world(date(2026, 10, 14), visits=[{"visits": "0"}]))
    assert roll(tmp_path, http) == "rolled up"
    for day in (date(2026, 7, 20), date(2026, 10, 12), date(2026, 10, 13)):
        assert asked_for(http, day) == [], day
    assert asked_for(http, date(2026, 10, 14))[0] == vr.visits_sql(date(2026, 10, 14))
    _, rows = read_csv(tmp_path / vr.SUMMARY)
    assert [r["date"] for r in rows if r["engaged_visitors"] != ""] == ["2026-10-14", "2026-10-21"]


def test_the_catch_up_is_bounded_to_the_newest_days_a_night(tmp_path):
    held = [YESTERDAY - timedelta(days=n) for n in range(1, vr.CATCH_UP_DAYS + 11)]
    write_summary(tmp_path, [held_row(d.isoformat()) for d in sorted(held)])
    http = FakeHttp(catch_up_world(*held))
    assert roll(tmp_path, http) == "rolled up"
    asked = [d for d in held if asked_for(http, d)]
    assert asked == held[:vr.CATCH_UP_DAYS]  # newest first
    # Yesterday's seven and four, then at most five for each day caught up.
    assert len(http.posts) <= 11 + 5 * vr.CATCH_UP_DAYS
    # The rest follow on the next nights.
    http = FakeHttp(catch_up_world(*held))
    assert roll(tmp_path, http) == "rolled up"
    assert [d for d in held if asked_for(http, d)] == held[vr.CATCH_UP_DAYS:]
    _, rows = read_csv(tmp_path / vr.SUMMARY)
    assert all(r["engaged_visitors"] == "7" for r in rows)


def test_a_failed_catch_up_query_leaves_that_day_as_it_was_and_the_night_goes_on(tmp_path, caplog):
    days = [date(2026, 10, 18), date(2026, 10, 19), date(2026, 10, 20)]
    write_summary(tmp_path, [held_row(d.isoformat()) for d in days])

    class FailsOn19th(FakeHttp):
        def post(self, url, data=None, headers=None, timeout=None):
            sql = data.decode("utf-8")
            if f">= toDateTime({vr.day_bounds(date(2026, 10, 19))[0]})" in sql and "AS phone " in sql:
                self.posts.append({"url": url, "sql": sql, "headers": headers})
                return FakeResponse(503, None, "unavailable")
            return super().post(url, data=data, headers=headers, timeout=timeout)

    http = FailsOn19th(catch_up_world(*days))
    assert roll(tmp_path, http) == "rolled up"
    _, rows = read_csv(tmp_path / vr.SUMMARY)
    by_date = {r["date"]: r["engaged_visitors"] for r in rows}
    # The 20th (newest first) was filled, the 19th failed part way and is left blank, the 18th waits.
    assert by_date == {"2026-10-18": "", "2026-10-19": "", "2026-10-20": "7", "2026-10-21": "7"}
    assert asked_for(http, date(2026, 10, 18)) == []
    assert "catch-up stopped at 2026-10-19" in caplog.text and TOKEN not in caplog.text
    # The next night picks up the two left.
    http = FakeHttp(catch_up_world(*days))
    assert roll(tmp_path, http) == "rolled up"
    assert all(r["engaged_visitors"] == "7" for r in read_csv(tmp_path / vr.SUMMARY)[1])


def test_the_catch_up_runs_only_on_a_night_that_writes_the_summary(tmp_path):
    earlier = date(2026, 10, 19)
    write_summary(tmp_path, [held_row("2026-10-19")])
    before = (tmp_path / vr.SUMMARY).read_text(encoding="utf-8")
    # Yesterday has no data point: nothing is uploaded tonight, so nothing is caught up.
    http = FakeHttp({earlier: (KINDS, COUNTS, FEEDS, FLAGGED)})
    assert roll(tmp_path, http) == "no data"
    assert asked_for(http, earlier) == [] and (tmp_path / vr.SUMMARY).read_text(encoding="utf-8") == before
    # A day asked for by hand rolls up that day and no other.
    http = FakeHttp(catch_up_world(earlier))
    assert roll(tmp_path, http, day=YESTERDAY) == "rolled up"
    assert asked_for(http, earlier) == []
