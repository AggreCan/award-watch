"""The monthly audience report, from summary rows and Search Console rows written here."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from awardwatch_pipeline import nightly, resilience, search_console as sc, views_report as vrep, views_rollup as vr


def summary_row(day: str, **values) -> dict:
    row = dict.fromkeys(vr.SUMMARY_HEADER, "")
    row.update(date=day, responses=1000, pages=500, api=0, downloads=0, forms=0, feeds=0, other=0, feed_subscribers=0,
               top_routes="")
    row.update(values)
    return row


def people(human: int, ca: int, us: int, desktop: int, mobile: int, routes: dict, uniques: int | str, visits: int | str):
    return dict(
        human_pages=human, bot_pages=900,
        human_by_country=json.dumps({"CA": ca, "US": us, "other": human - ca - us}),
        human_by_device=json.dumps({"desktop": desktop, "mobile": mobile, "tablet": human - desktop - mobile}),
        human_by_lang=json.dumps({"en": human}), human_by_route=json.dumps(routes),
        unique_visitors=uniques, human_visits=visits,
    )


ROWS = [
    # September: before the bot flag, the people columns blank.
    summary_row("2026-09-29", feed_subscribers=10, organizations=90000),
    summary_row("2026-09-30", feed_subscribers=12, organizations=91000, records=1970000),
    # October: the 29th before the visitor code was set, then two full days.
    summary_row("2026-10-29", **people(100, 80, 10, 60, 30, {"/organizations/:id": 70, "/": 30}, "", ""),
                feed_subscribers=15),
    summary_row("2026-10-30", **people(200, 150, 30, 120, 70, {"/organizations/:id": 150, "/tenders": 50}, 120, 110),
                feed_subscribers=14, organizations=91200, records=2000000),
    summary_row("2026-10-31", **people(300, 240, 40, 150, 130, {"/organizations/:id": 200, "/": 60, "/tenders": 40}, 180, 170),
                feed_subscribers=13, organizations=91234, records=2010000),
]
SEARCH = [
    {"date": "2026-10-28", "clicks": "10", "impressions": "100", "ctr": "0.1", "position": "8.0", "top_queries": "[]"},
    {"date": "2026-10-29", "clicks": "20", "impressions": "300", "ctr": "0.066", "position": "4.0", "top_queries": "[]"},
    {"date": "2026-09-15", "clicks": "5", "impressions": "50", "ctr": "0.1", "position": "10.0", "top_queries": "[]"},
]


def write_files(tmp_path, rows=ROWS, search=SEARCH):
    summary = tmp_path / "summary.csv"
    vr._write_csv(summary, vr.SUMMARY_HEADER, rows)
    search_path = tmp_path / "search_console.csv"
    sc.write_file(search_path, search)
    return summary, search_path


def table_row(text: str, label: str) -> list[str]:
    line = next(ln for ln in text.splitlines() if ln.startswith(f"| {label} |"))
    return [cell.strip() for cell in line.strip("|").split("|")][1:]


def test_months():
    assert vrep.month_bounds("2026-02") == (date(2026, 2, 1), date(2026, 2, 28))
    assert vrep.month_bounds("2026-12") == (date(2026, 12, 1), date(2026, 12, 31))
    assert vrep.previous_months("2026-02") == ["2025-11", "2025-12", "2026-01", "2026-02"]
    assert vrep.report_month(date(2026, 11, 1)) == "2026-10"
    assert vrep.report_month(date(2027, 1, 31)) == "2026-12"


def test_the_report_puts_the_month_beside_the_three_before_it(tmp_path):
    summary, search = write_files(tmp_path)
    out = tmp_path / "out"
    assert vrep.run(out, "2026-10", date(2026, 11, 1), summary, search) == "written"
    text = (out / "report-2026-10.md").read_text(encoding="utf-8")
    assert text.startswith("# Award Watch audience report, 2026-10\n")
    assert "| Figure | 2026-07 | 2026-08 | 2026-09 | 2026-10 |" in text
    assert table_row(text, "Days in the roll-up") == ["0 of 31", "0 of 31", "2 of 30", "3 of 31"]
    assert table_row(text, "Days with people counted") == ["0 of 31", "0 of 31", "0 of 30", "3 of 31"]
    assert table_row(text, "Page views by people") == ["n/a", "n/a", "n/a", "600"]
    assert table_row(text, "Days with visitor counts") == ["0 of 31", "0 of 31", "0 of 30", "2 of 31"]
    assert table_row(text, "Unique visitors (visitor-days)") == ["n/a", "n/a", "n/a", "300"]
    assert table_row(text, "Visits") == ["n/a", "n/a", "n/a", "280"]
    assert table_row(text, "Canada share of people's page views")[-1] == "78.3%"  # 470 of 600
    assert table_row(text, "Desktop share")[-1] == "55.0%"  # 330 of 600
    assert table_row(text, "Mobile share")[-1] == "38.3%"  # 230 of 600
    assert table_row(text, "Tablet share")[-1] == "6.7%"
    assert table_row(text, "Days with search figures") == ["0 of 31", "0 of 31", "1 of 30", "2 of 31"]
    assert table_row(text, "Search clicks") == ["n/a", "n/a", "5", "30"]
    assert table_row(text, "Search impressions") == ["n/a", "n/a", "50", "400"]
    assert table_row(text, "Average search position") == ["n/a", "n/a", "10.0", "5.0"]  # (8x100 + 4x300) / 400
    assert table_row(text, "Feed subscribers (largest daily figure)") == ["n/a", "n/a", "12", "15"]
    assert table_row(text, "Organizations (last reading)") == ["n/a", "n/a", "91,000", "91,234"]
    assert table_row(text, "Records (last reading)") == ["n/a", "n/a", "1,970,000", "2,010,000"]
    pages = text.split("## Top pages by people, 2026-10", 1)[1]
    assert "| `/organizations/:id` | 420 | 70.0% |" in pages
    assert pages.index("`/organizations/:id`") < pages.index("`/` ") < pages.index("`/tenders`")
    assert "## Definitions" in text
    for dash in (chr(0x2014), chr(0x2013)):  # no em or en dash in the report's prose
        assert dash not in text
    # The public line says where the report is and nothing more; the figures go in the private one.
    assert (out / "summary_line.txt").read_text(encoding="utf-8") == "2026-10 written to R2 as views/report-2026-10.md\n"
    assert (out / "month_line.txt").read_text(encoding="utf-8") == (
        "month 2026-10: page views by people 600; engaged visitor-days n/a, from search n/a, on a phone or tablet n/a; "
        "visitor-days 300, visits 280; search clicks 30, impressions 400; Canada 78.3%; report views/report-2026-10.md\n")


def test_the_report_waits_a_week_for_the_months_last_day(tmp_path):
    summary, search = write_files(tmp_path, rows=ROWS[:-1])
    out = tmp_path / "out"
    assert vrep.run(out, "2026-10", date(2026, 11, 1), summary, search) == "waiting"
    assert vrep.run(out, "2026-10", date(2026, 11, 7), summary, search) == "waiting"
    assert not (out / "report-2026-10.md").exists()
    assert vrep.run(out, "2026-10", date(2026, 11, 8), summary, search) == "written"
    assert table_row((out / "report-2026-10.md").read_text(encoding="utf-8"), "Days in the roll-up")[-1] == "2 of 31"


def test_no_rows_for_the_month_is_no_data_and_a_bad_summary_or_month_is_failed(tmp_path):
    summary, search = write_files(tmp_path, rows=ROWS[:2])
    out = tmp_path / "out"
    assert vrep.run(out, "2026-10", date(2026, 11, 1), summary, search) == "no data"
    assert vrep.run(out, "2026-10", date(2026, 11, 1), tmp_path / "missing.csv", None) == "no data"
    assert vrep.run(out, "2026-10", date(2026, 10, 31), summary, search) == "failed"  # not over
    assert vrep.run(out, "2026-13", date(2026, 11, 1), summary, search) == "failed"
    summary.write_text("date,visitors_ip\n2026-10-01,1\n", encoding="utf-8")
    assert vrep.run(out, "2026-10", date(2026, 11, 1), summary, search) == "failed"
    assert not list(out.glob("report-*.md"))


def test_without_search_console_the_search_rows_read_not_counted(tmp_path):
    summary, _ = write_files(tmp_path)
    out = tmp_path / "out"
    assert vrep.run(out, "2026-10", date(2026, 11, 1), summary, tmp_path / "absent.csv") == "written"
    text = (out / "report-2026-10.md").read_text(encoding="utf-8")
    assert table_row(text, "Search clicks") == ["n/a"] * 4
    assert "; search clicks n/a, impressions n/a; " in (out / "month_line.txt").read_text(encoding="utf-8")


def test_the_command_writes_its_outcome_and_exits_1_only_when_failed(tmp_path):
    summary, search = write_files(tmp_path)
    out = tmp_path / "out"
    args = ["views-report", "--summary", str(summary), "--search", str(search), "--out", str(out)]
    assert nightly.main(args + ["--today", "2026-11-01"]) == 0
    assert (out / "outcome.txt").read_text(encoding="utf-8") == "written\n"
    assert (out / "report-2026-10.md").exists()
    assert nightly.main(args + ["--today", "2026-10-31", "--month", "2026-10"]) == 1
    assert (out / "outcome.txt").read_text(encoding="utf-8") == "failed\n"
    assert nightly.main(["views-report", "--summary", str(tmp_path / "none.csv"), "--out", str(out),
                     "--today", "2026-11-01"]) == 0
    assert (out / "outcome.txt").read_text(encoding="utf-8") == "no data\n"


def test_the_run_status_carries_the_report_and_only_failed_needs_attention(tmp_path):
    db = tmp_path / "none.sqlite"
    assert nightly.run_status(db, None, None, {}, views_report="written")["views_report"] == "written"
    assert nightly.run_status(db, None, None, {})["views_report"] == "not run"
    clean = {"stages": []}
    for quiet in ("written", "not due", "waiting", "no data", "not run"):
        assert resilience.attention_items({**clean, "views_report": quiet}) == [], quiet
    assert resilience.attention_items({**clean, "views_report": "failed"}) == [
        "Monthly audience report: failed (tried again next run)"]
    (tmp_path / "report.txt").write_text("not due\n", encoding="utf-8")
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(db), "--views-report-outcome", str(tmp_path / "report.txt"),
                         "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["views_report"] == "not due"


def test_the_report_carries_the_alert_sign_ups_and_neither_line_does(tmp_path):
    summary, search = write_files(tmp_path)
    out = tmp_path / "out"
    assert vrep.run(out, "2026-10", date(2026, 11, 1), summary, search, interest={"n": 1234, "live": 1200}) == "written"
    text = (out / "report-2026-10.md").read_text(encoding="utf-8")
    section = text.split("## Alert sign-ups\n\n", 1)[1].split("\n## ", 1)[0]
    assert section.startswith("1,234 sign-ups when this report was written, 1,200 of them not unsubscribed.")
    assert text.index("## Top pages by people") < text.index("## Alert sign-ups") < text.index("## Definitions")
    assert "- Alert sign-ups: rows of the interest table" in text
    for name in ("summary_line.txt", "month_line.txt"):
        line = (out / name).read_text(encoding="utf-8")
        assert "sign-up" not in line and "1,234" not in line and "1,200" not in line, name
    assert vrep.run(out, "2026-10", date(2026, 11, 1), summary, search) == "written"
    assert "## Alert sign-ups\n\nNot counted. The forms database could not be read" in (
        out / "report-2026-10.md").read_text(encoding="utf-8")


def test_the_report_carries_the_three_reader_counts_and_says_what_each_can_tell(tmp_path):
    rows = [
        # Before the three counts: blank, so the month reads n/a for them.
        summary_row("2026-09-30", **people(50, 40, 5, 30, 15, {"/": 50}, 40, 35)),
        # Two days with all three, one with search not counted (left out of all three).
        summary_row("2026-10-30", **people(200, 150, 30, 120, 70, {"/": 200}, 120, 110),
                    engaged_visitors=7, search_visitors=9, phone_visitors=6),
        summary_row("2026-10-31", **people(300, 240, 40, 150, 130, {"/": 300}, 180, 170),
                    engaged_visitors=8, search_visitors=12, phone_visitors=0),
        summary_row("2026-10-29", **people(100, 80, 10, 60, 30, {"/": 100}, 90, 80),
                    engaged_visitors=6, search_visitors="", phone_visitors=3),
    ]
    summary, search = write_files(tmp_path, rows=rows)
    out = tmp_path / "out"
    assert vrep.run(out, "2026-10", date(2026, 11, 1), summary, search) == "written"
    text = (out / "report-2026-10.md").read_text(encoding="utf-8")
    assert table_row(text, "Days with engaged, search and phone counts") == ["0 of 31", "0 of 31", "0 of 30", "2 of 31"]
    assert table_row(text, "Engaged visitors (visitor-days)") == ["n/a", "n/a", "n/a", "15"]
    assert table_row(text, "Visitors from search (visitor-days)") == ["n/a", "n/a", "n/a", "21"]
    assert table_row(text, "Visitors on a phone or tablet (visitor-days)") == ["n/a", "n/a", "n/a", "6"]
    # Beside the unique visitors, in the table's order.
    labels = [ln.split("|")[1].strip() for ln in text.splitlines() if ln.startswith("| ")]
    at = labels.index("Visits")
    assert labels[at + 1:at + 5] == ["Days with engaged, search and phone counts", "Engaged visitors (visitor-days)",
                                     "Visitors from search (visitor-days)", "Visitors on a phone or tablet (visitor-days)"]
    # The paragraph under the table says what each figure can tell.
    reading = text.split("| Records (last reading) |", 1)[1].split("\n## ", 1)[0]
    assert "includes automated browsers that copy those headers" in reading
    assert "the figures to read as people" in reading
    for left_out in ("everyone who read one page", "came by a link, a bookmark or a typed address", "on a desktop"):
        assert left_out in reading, left_out
    for word in ("Engaged visitors: ", "Visitors from search: ", "Visitors on a phone or tablet: "):
        assert f"\n- {word}" in text, word
    for dash in (chr(0x2014), chr(0x2013)):
        assert dash not in text
    # The public line for LAST_RUN.md carries none of them; the private line
    # puts them right after the page views by people.
    assert (out / "summary_line.txt").read_text(encoding="utf-8") == "2026-10 written to R2 as views/report-2026-10.md\n"
    assert (out / "month_line.txt").read_text(encoding="utf-8") == (
        "month 2026-10: page views by people 600; engaged visitor-days 15, from search 21, on a phone or tablet 6; "
        "visitor-days 390, visits 360; search clicks 30, impressions 400; Canada 78.3%; report views/report-2026-10.md\n")


def test_the_public_line_holds_no_figure_and_the_command_prints_none(tmp_path, capsys, caplog):
    caplog.set_level("INFO")
    rows = [summary_row("2026-10-31", **people(7301, 7302, 7, 7303, 7, {"/": 7301}, 7304, 7305),
                        engaged_visitors=7306, search_visitors=7307, phone_visitors=7308, feed_subscribers=7309,
                        organizations=7310, records=7311)]
    search = [{"date": "2026-10-30", "clicks": "7312", "impressions": "7313", "ctr": "0.5", "position": "7.0",
               "top_queries": "[]"}]
    summary, search_path = write_files(tmp_path, rows=rows, search=search)
    out = tmp_path / "out"
    assert nightly.main(["views-report", "--summary", str(summary), "--search", str(search_path), "--out", str(out),
                         "--today", "2026-11-01"]) == 0
    printed = capsys.readouterr()
    assert printed.out == "views-report 2026-10: written\n"
    public = (out / vrep.SUMMARY_LINE).read_text(encoding="utf-8")
    private = (out / vrep.MONTH_LINE).read_text(encoding="utf-8")
    # The public line: no digit but the month's own (and R2's).
    assert not any(ch.isdigit() for ch in public.replace("2026-10", "").replace("R2", "")), public
    for n in range(7301, 7314):
        for shown in (str(n), f"{n:,}"):
            assert shown not in printed.out + printed.err + caplog.text + public, n
    # The private line has them (those it carries), on one line.
    for shown in ("7,301", "7,304", "7,305", "7,306", "7,307", "7,308", "7,312", "7,313"):
        assert shown in private, shown
    assert private.count("\n") == 1 and private.endswith("\n")


def test_the_report_command_reads_the_count_wrangler_wrote(tmp_path):
    summary, search = write_files(tmp_path)
    out = tmp_path / "out"
    answer = Path(__file__).parent / "fixtures" / "d1_interest_count.json"
    assert nightly.main(["views-report", "--summary", str(summary), "--search", str(search), "--out", str(out),
                         "--today", "2026-11-01", "--interest", str(answer)]) == 0
    assert "12 sign-ups when this report was written, 11 of them not unsubscribed." in (
        out / "report-2026-10.md").read_text(encoding="utf-8")
