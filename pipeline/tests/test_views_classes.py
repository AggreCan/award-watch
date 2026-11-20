"""The classes counted apart from people (the Worker's rule "2", 2026-11-19) in the roll-up: the hosted and closed
page views, the hosted class's countries and routes, people's views of the plans and sign-in pages, and the days
that counted the crawler pool as people. Against the stub session of test_views_rollup: nothing reaches the
network."""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from awardwatch_pipeline import views_rollup as vr
from test_views_rollup import COUNTS, FEEDS, FLAGGED, KINDS, YESTERDAY, FakeHttp, read_csv, roll

ROOT = Path(__file__).resolve().parents[2]
VIEWS_TS = ROOT / "site" / "src" / "views.ts"

# A day under the rule: people, bots, the pool from Hong Kong and the US as hosted, and the response form opened
# from nowhere as closed.
CLASSED = [
    {"agent": "human", "country": "CA", "device": "desktop", "lang": "en", "pages": "60"},
    {"agent": "human", "country": "CA", "device": "mobile", "lang": "fr", "pages": "20"},
    {"agent": "bot", "country": "US", "device": "", "lang": "en", "pages": "300"},
    {"agent": "hosted", "country": "US", "device": "desktop", "lang": "en", "pages": "50000"},
    {"agent": "hosted", "country": "HK", "device": "desktop", "lang": "en", "pages": "30000"},
    {"agent": "closed", "country": "US", "device": "desktop", "lang": "en", "pages": "2890"},
]
PEOPLE_ROUTES = [{"route": "/organizations/:id", "pages": "50"}, {"route": "/pro", "pages": "9"},
                 {"route": "/account/sign-in", "pages": "5"}, {"route": "/", "pages": "16"}]
HOSTED_ROUTES = [{"route": "/organizations/:id", "hosted": "52000"}, {"route": "/history/:reference", "hosted": "27000"},
                 {"route": "/organizations/:id/respond", "hosted": "1000"}]


def classed_day(**changes) -> dict:
    return {YESTERDAY: (KINDS, COUNTS, FEEDS, {**FLAGGED, "audience": CLASSED, "routes": PEOPLE_ROUTES,
                                               "rule": [{"unruled": "0"}], "hosted_routes": HOSTED_ROUTES, **changes})}


def last_row(folder) -> dict:
    _, rows = read_csv(folder / vr.SUMMARY)
    return rows[-1]


def test_the_rule_and_the_classes_match_the_workers():
    source = VIEWS_TS.read_text(encoding="utf-8")
    assert re.search(r'^export const AGENT_RULE = "([^"]+)";$', source, re.M).group(1) == vr.AGENT_RULE
    audience = re.search(r'^export type Audience = Agent \| "([a-z]+)" \| "([a-z]+)";$', source, re.M)
    agent = re.search(r'^export type Agent = "([a-z]+)" \| "([a-z]+)";$', source, re.M)
    assert {*audience.groups(), *agent.groups()} == vr.AGENTS
    # The two pages between a visit and an account, by the templates the Worker writes.
    assert f'"{vr.PLANS_ROUTE}"' in source and '"sign-in"' in source and vr.SIGN_IN_ROUTE == "/account/sign-in"
    assert vr.CLASS_COLUMNS == vr.SUMMARY_HEADER[-len(vr.CLASS_COLUMNS):]


def test_the_two_new_queries_read_classes_and_never_a_code():
    where = f"timestamp >= toDateTime({vr.day_bounds(YESTERDAY)[0]}) AND timestamp < toDateTime({vr.day_bounds(YESTERDAY)[1]})"
    assert vr.rule_sql(YESTERDAY) == (
        "SELECT sumIf(_sample_interval, blob12 != '2') AS unruled FROM awardwatch_views "
        f"WHERE blob2 = 'page' AND double1 < 400 AND {where} FORMAT JSON")
    assert vr.hosted_routes_sql(YESTERDAY) == (
        "SELECT blob1 AS route, SUM(_sample_interval) AS hosted FROM awardwatch_views "
        f"WHERE blob2 = 'page' AND double1 < 400 AND blob8 = 'hosted' AND {where} "
        "GROUP BY route ORDER BY hosted DESC LIMIT 10000 FORMAT JSON")
    for sql in (vr.rule_sql(YESTERDAY), vr.hosted_routes_sql(YESTERDAY)):
        assert "blob10" not in sql


def test_a_day_under_the_rule_counts_people_alone_and_the_classes_apart(tmp_path):
    http = FakeHttp(classed_day())
    assert roll(tmp_path, http) == "rolled up"
    row = last_row(tmp_path)
    # People alone: the 80,000 hosted and the 2,890 closed page views are in no people's figure.
    assert (row["human_pages"], row["bot_pages"]) == ("80", "300")
    assert row["human_by_country"] == '{"CA":80}'
    assert row["human_by_device"] == '{"desktop":60,"mobile":20}'
    assert row["human_by_route"] == '{"/organizations/:id":50,"/":16,"/pro":9,"/account/sign-in":5}'
    assert {k: row[k] for k in vr.CLASS_COLUMNS} == {
        "hosted_pages": "80000", "closed_pages": "2890",
        "hosted_by_country": '{"US":50000,"HK":30000}',
        "hosted_by_route": '{"/organizations/:id":52000,"/history/:reference":27000,"/organizations/:id/respond":1000}',
        "plans_pages": "9", "sign_in_pages": "5",
    }
    # The visitor columns are asked of the human class alone, as before.
    assert all("blob8 = 'human'" in p["sql"] for p in http.posts if "blob10" in p["sql"])
    # The day file keeps each class's page views by country, device and language.
    _, rows = read_csv(tmp_path / "2026-10-21.csv")
    audience = {(r["agent"], r["country"]): r["responses"] for r in rows if r["section"] == "audience"}
    assert audience[("hosted", "HK")] == "30000" and audience[("closed", "US")] == "2890"
    assert vr.pool_days([row]) == []


def test_a_day_with_no_view_of_the_two_pages_reads_0_under_the_rule(tmp_path):
    assert roll(tmp_path, FakeHttp(classed_day(routes=PEOPLE_ROUTES[:1], hosted_routes=[]))) == "rolled up"
    row = last_row(tmp_path)
    assert (row["plans_pages"], row["sign_in_pages"], row["hosted_by_route"]) == ("0", "0", "{}")


def test_a_day_counted_in_part_before_the_rule_leaves_the_classes_blank(tmp_path):
    # The deploy's own day: some page views carry no rule version. Its people's figures are filled as before.
    for rule in ([{"unruled": "412"}], [{"unruled": "x"}], [], [{"unruled": "0"}, {"unruled": "0"}]):
        http = FakeHttp(classed_day(rule=rule))
        assert roll(tmp_path, http) == "rolled up", rule
        row = last_row(tmp_path)
        assert all(row[k] == "" for k in vr.CLASS_COLUMNS), rule
        assert row["human_pages"] == "80", rule
        # The hosted class's routes are not asked for a day that cannot fill them.
        assert not any("AS hosted " in p["sql"] for p in http.posts), rule


def test_a_day_before_the_bot_flag_asks_neither_new_question(tmp_path):
    http = FakeHttp()
    assert roll(tmp_path, http) == "rolled up"
    assert not any("AS unruled" in p["sql"] or "AS hosted " in p["sql"] for p in http.posts)
    assert all(last_row(tmp_path)[k] == "" for k in vr.CLASS_COLUMNS)


def test_a_summary_written_before_the_class_columns_reads_and_keeps_its_rows(tmp_path):
    old_header = vr.SUMMARY_HEADER[:-len(vr.CLASS_COLUMNS)]
    (tmp_path / vr.SUMMARY).write_text(
        ",".join(old_header) + "\n2026-10-20,100,80,10,5,1,4,0,6,/ 60,92,300,41,37,{},{},{},{},,,7,9,6\n", encoding="utf-8")
    assert roll(tmp_path, FakeHttp(classed_day())) == "rolled up"
    header, rows = read_csv(tmp_path / vr.SUMMARY)
    assert header == vr.SUMMARY_HEADER
    assert [r["date"] for r in rows] == ["2026-10-20", "2026-10-21"]
    # The older row keeps every value it had, under every name it had, and reads blank in the new columns.
    assert (rows[0]["human_pages"], rows[0]["engaged_visitors"], rows[0]["phone_visitors"]) == ("92", "7", "6")
    assert all(rows[0][k] == "" for k in vr.CLASS_COLUMNS)
    assert rows[1]["hosted_pages"] == "80000"


def test_the_days_that_counted_the_pool_as_people():
    def row(day: str, human: str = "80000", hosted: str = "") -> dict:
        return {**dict.fromkeys(vr.SUMMARY_HEADER, ""), "date": day, "human_pages": human, "hosted_pages": hosted}

    rows = [row("2026-11-11"), row("2026-11-12"), row("2026-11-13"), row("2026-11-14"), row("2026-11-15", human=""),
            row("2026-11-16"), row("2026-11-20", human="60", hosted="70000"), row("2026-11-21", human="45", hosted="0")]
    assert vr.POOL_FIRST_DAY == date(2026, 11, 13)
    # From the first affected day, every day with people counted and no class counted apart; a day without the bot
    # flag counts no people at all and is not among them; a day under the rule is not.
    assert vr.pool_days(rows) == ["2026-11-13", "2026-11-14", "2026-11-16"]
    assert vr.day_span(["2026-11-13", "2026-11-14", "2026-11-16"]) == "2026-11-13 to 2026-11-16 (3 days)"
    assert vr.day_span(["2026-11-13"]) == "2026-11-13" and vr.day_span([]) == ""
