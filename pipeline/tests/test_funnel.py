"""The account funnel's daily figures: the count statement against the real
accounts schema in SQLite, the row and the line, and where the workflow puts
them. Nothing here reaches the network."""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import date
from pathlib import Path

from awardwatch_pipeline import funnel, nightly, resilience, views_report as vrep, views_rollup as vr

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "site" / "accounts_schema.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "nightly.yml"
WATCHDOG = ROOT / "site" / "src" / "watchdog.ts"
DAY = date(2026, 11, 10)


def answer(day: str = "2026-11-10", **counts) -> list[dict]:
    """Wrangler's answer to the statement, as `d1 execute --remote --json` prints it."""
    row = {"day": day, "accounts": 3, "accounts_new": 1, "codes_requested": 4, "sign_ins": 2, "pro": 1,
           "saved_searches": 5, "watches": 6}
    row.update(counts)
    return [{"results": [row], "success": True, "meta": {"served_by": "v3-prod", "rows_read": 40}}]


def write_answer(path: Path, data: object) -> Path:
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def write_summary(path: Path, day: str = "2026-11-10", **values) -> Path:
    row = dict.fromkeys(vr.SUMMARY_HEADER, "")
    row.update(date=day, responses=900, human_pages=120, unique_visitors=150, human_visits=140,
               engaged_visitors=7, search_visitors=9, phone_visitors=6)
    row.update(values)
    vr._write_csv(path, vr.SUMMARY_HEADER, [row])
    return path


# -- the statement --------------------------------------------------------------


def test_the_statement_asks_for_counts_and_names_no_address():
    sql = funnel.accounts_sql(DAY)
    assert sql.startswith("SELECT '2026-11-10' AS day, (SELECT COUNT(*) FROM users WHERE status = 'active') AS accounts, ")
    assert "created_at >= '2026-11-10' AND created_at < '2026-11-11'" in sql
    assert "event = 'code_requested' AND at >= '2026-11-10' AND at < '2026-11-11'" in sql
    assert "event = 'signed_in' AND at >= '2026-11-10' AND at < '2026-11-11'" in sql
    # Each selected value is a count, in the record's column order.
    names = re.findall(r"\) AS (\w+)(?:, |$)", sql)
    assert names == funnel.COUNTS
    for column in ("email", "token", "code_hash", "ip_hash", "params", "label", "target", "reference", "detail"):
        assert column not in sql, column
    # One line, no double quote: the workflow passes it to --command in double quotes.
    assert "\n" not in sql and '"' not in sql and "$" not in sql and "`" not in sql
    # The day rolls over a month's end.
    assert "at < '2026-12-01'" in funnel.accounts_sql(date(2026, 11, 30))


def accounts_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    return conn


def add_user(conn, uid: str, created: str, status: str = "active") -> None:
    conn.execute("INSERT INTO users (id, email, created_at, status) VALUES (?, ?, ?, ?)",
                 (uid, f"{uid}@example.invalid", created, status))


def add_plan(conn, eid: str, uid: str, plan: str, created: str, *, starts: str = "2026-01-01T00:00:00.000Z",
             ends: str | None = None, revoked: str | None = None) -> None:
    conn.execute("INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, created_at, revoked_at) "
                 "VALUES (?, ?, ?, 'manual', ?, ?, ?, ?)", (eid, uid, plan, starts, ends, created, revoked))


def test_the_statement_counts_the_day_and_the_levels_in_the_real_schema():
    conn = accounts_db()
    add_user(conn, "u1", "2026-10-01T10:00:00.000Z")
    add_user(conn, "u2", "2026-11-10T00:00:00.000Z")           # made on the day, at its first instant
    add_user(conn, "u3", "2026-11-10T23:59:59.999Z")           # and at its last
    add_user(conn, "u4", "2026-11-11T00:00:00.000Z")           # the next day: not the day's
    add_user(conn, "u5", "2026-11-10T08:00:00.000Z", "deleted")  # made on the day, deleted since
    add_user(conn, "u6", "2026-11-09T23:59:59.999Z")
    audit = [("u2", "code_requested", "2026-11-10T00:00:01.000Z"), ("u3", "code_requested", "2026-11-10T23:59:00.000Z"),
             ("u1", "code_requested", "2026-11-09T23:00:00.000Z"), ("u2", "signed_in", "2026-11-10T00:02:00.000Z"),
             ("u1", "signed_in", "2026-11-11T00:00:00.000Z"), ("u3", "code_wrong", "2026-11-10T23:59:30.000Z")]
    conn.executemany("INSERT INTO audit (user_id, event, at) VALUES (?, ?, ?)", audit)
    # Pro as the operator console counts it: the latest live row of an active account decides.
    add_plan(conn, "e1", "u1", "pro", "2026-10-02T00:00:00.000Z")                      # Pro, no end
    add_plan(conn, "e2", "u2", "pro", "2026-11-10T00:01:00.000Z", ends="2099-01-01T00:00:00.000Z")
    add_plan(conn, "e3", "u2", "free", "2026-11-10T00:03:00.000Z")                     # a later free row wins
    add_plan(conn, "e4", "u3", "pro", "2026-11-10T00:00:00.000Z", revoked="2026-11-10T01:00:00.000Z")
    add_plan(conn, "e5", "u6", "pro", "2026-11-09T00:00:00.000Z", ends="2026-11-09T12:00:00.000Z")  # ended
    add_plan(conn, "e6", "u5", "pro", "2026-11-10T08:00:00.000Z")                      # deleted account
    add_plan(conn, "e7", "u4", "pro", "2026-11-11T00:00:00.000Z", starts="2099-01-01T00:00:00.000Z")  # not begun
    conn.execute("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at) "
                 "VALUES ('s1', 'u1', 'tenders', '/tenders', 'Tenders', 'en', '2026-10-02T00:00:00.000Z')")
    for i, uid in enumerate(("u1", "u1", "u2")):
        conn.execute("INSERT INTO watches (id, user_id, kind, target, label, events, created_at) "
                     "VALUES (?, ?, 'buyer', ?, 'A buyer', 'all', '2026-11-01T00:00:00.000Z')", (f"w{i}", uid, f"b{i}"))
    cur = conn.execute(funnel.accounts_sql(DAY))
    row = dict(zip([d[0] for d in cur.description], cur.fetchone()))
    assert row == {"day": "2026-11-10", "accounts": 5, "accounts_new": 3, "codes_requested": 2, "sign_ins": 1,
                   "pro": 1, "saved_searches": 1, "watches": 3}
    # What Wrangler would print for that row reads back as the same counts.
    counts = funnel.account_counts([{"results": [row], "success": True}], DAY)
    assert counts == {k: row[k] for k in funnel.COUNTS}


def test_pro_is_counted_as_the_operator_console_counts_it():
    # site/src/account/admin_ops.ts, overview: the same rows (each active account's latest live entitlement) with
    # its "now" as ?1. The console adds a split by plan and source and reads Ultra through entitlement_tiers, a
    # table the funnel cannot count on; an Ultra account's deciding row is a pro row, so the funnel's Pro holds it.
    admin = (ROOT / "site" / "src" / "account" / "admin_ops.ts").read_text(encoding="utf-8")
    block = admin.split("// Accounts whose plan is Pro or Ultra now", 1)[1].split(".bind(", 1)[0]
    ours = funnel.PRO_SQL.replace(funnel.NOW, "?1")
    shared = ("ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at DESC, e.id DESC) AS r ",
              "FROM entitlements e JOIN users u ON u.id = e.user_id AND u.status = 'active' ",
              "WHERE e.revoked_at IS NULL AND e.starts_at <= ?1 AND (e.ends_at IS NULL OR e.ends_at > ?1)) WHERE r = 1 AND plan ")
    for piece in shared:
        assert piece in block, piece
    assert ours == "SELECT COUNT(*) FROM (SELECT e.plan, " + "".join(shared) + "= 'pro'"
    # Without the tier table the console reads e.plan as the funnel does, and counts the same two plans.
    assert '"e.plan"' in block and "IN ('pro', 'ultra')" in block


# -- the answer, the row and the line ---------------------------------------------------


def test_the_answer_reads_only_counts_for_the_day_asked():
    assert funnel.account_counts(answer(), DAY) == {"accounts": 3, "accounts_new": 1, "codes_requested": 4,
                                                    "sign_ins": 2, "pro": 1, "saved_searches": 5, "watches": 6}
    assert funnel.account_counts(answer(day="2026-11-09"), DAY) is None   # another night's answer
    assert funnel.account_counts([{"success": False, "results": []}], DAY) is None
    assert funnel.account_counts([], DAY) is None and funnel.account_counts("x", DAY) is None
    odd = funnel.account_counts(answer(pro=-1, watches="6", sign_ins=True, accounts=None), DAY)
    assert odd == {"accounts": None, "accounts_new": 1, "codes_requested": 4, "sign_ins": None, "pro": None,
                   "saved_searches": 5, "watches": None}


def test_the_line_names_each_figure_and_says_n_a_for_one_not_read():
    row = {"date": "2026-11-10", "accounts": "12", "accounts_new": "2", "codes_requested": "3", "sign_ins": "0",
           "pro": "", "saved_searches": "4", "watches": "1200"}
    audience = {"human_pages": 120, "engaged_visitors": 7, "search_visitors": None, "phone_visitors": 0}
    assert funnel.line(row, audience) == (
        "2026-11-10 (UTC): accounts 12 (new 2), sign-in codes asked for 3, sign-ins 0, Pro n/a, saved searches 4, "
        "watches 1,200; page views by people 120, engaged visitors 7, from search n/a, on a phone or tablet 0")
    blank = dict.fromkeys(funnel.HEADER, "") | {"date": "2026-11-10"}
    text = funnel.line(blank, dict.fromkeys(funnel.AUDIENCE))
    assert text.count("n/a") == len(funnel.COUNTS) + len(funnel.AUDIENCE)
    for dash in (chr(0x2014), chr(0x2013)):
        assert dash not in text


def test_a_night_writes_the_days_row_and_line_and_a_retry_replaces_them(tmp_path):
    counts = write_answer(tmp_path / "count.json", answer())
    summary = write_summary(tmp_path / "summary.csv")
    out = tmp_path / "out"
    out.mkdir()
    (out / funnel.FUNNEL).write_text(",".join(funnel.HEADER) + "\n2026-11-09,3,0,1,1,1,5,6\n", encoding="utf-8")
    assert funnel.run(out, DAY, counts, summary) == "written"
    lines = (out / funnel.FUNNEL).read_text(encoding="utf-8").splitlines()
    assert lines == [",".join(funnel.HEADER), "2026-11-09,3,0,1,1,1,5,6", "2026-11-10,3,1,4,2,1,5,6"]
    assert (out / funnel.LINE).read_text(encoding="utf-8") == (
        "2026-11-10 (UTC): accounts 3 (new 1), sign-in codes asked for 4, sign-ins 2, Pro 1, saved searches 5, "
        "watches 6; page views by people 120, engaged visitors 7, from search 9, on a phone or tablet 6\n")
    # A retry the same day whose count was not read keeps the counts the row had; the line says so too.
    assert funnel.run(out, DAY, tmp_path / "missing.json", summary) == "written"
    assert (out / funnel.FUNNEL).read_text(encoding="utf-8").splitlines()[-1] == "2026-11-10,3,1,4,2,1,5,6"
    assert "accounts 3 (new 1)" in (out / funnel.LINE).read_text(encoding="utf-8")
    # A retry that reads new levels replaces them in place: still one row for the day.
    assert funnel.run(out, DAY, write_answer(tmp_path / "count.json", answer(accounts=4)), summary) == "written"
    rows = (out / funnel.FUNNEL).read_text(encoding="utf-8").splitlines()
    assert len(rows) == 3 and rows[-1] == "2026-11-10,4,1,4,2,1,5,6"


def test_the_first_night_with_nothing_read_writes_blanks_and_n_a(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    garbled = tmp_path / "count.json"
    garbled.write_text("[ERROR] no such table: audit", encoding="utf-8")
    for counts, summary in ((None, None), (garbled, tmp_path / "missing.csv"),
                            (tmp_path / "missing.json", write_summary(tmp_path / "other-day.csv", day="2026-11-09"))):
        assert funnel.run(out, DAY, counts, summary) == "written"
        assert (out / funnel.FUNNEL).read_text(encoding="utf-8").splitlines()[-1] == "2026-11-10" + "," * 7
        text = (out / funnel.LINE).read_text(encoding="utf-8")
        assert text.startswith("2026-11-10 (UTC): accounts n/a (new n/a), ") and text.count("n/a") == 11
    # Blank audience columns (a day not coded) read n/a, a 0 reads 0.
    summary = write_summary(tmp_path / "summary.csv", engaged_visitors="", search_visitors=0)
    assert funnel.run(out, DAY, None, summary) == "written"
    text = (out / funnel.LINE).read_text(encoding="utf-8")
    assert "engaged visitors n/a, from search 0, on a phone or tablet 6" in text


def test_a_record_that_cannot_be_read_safely_is_never_replaced(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    for bad in ("date,accounts,email\n2026-11-09,1,someone@example.com\n",
                ",".join(funnel.HEADER) + "\nnot-a-date,1,0,0,0,0,0,0\n",
                ",".join(funnel.HEADER) + "\n2026-11-09,1,0,0,0,0,0,0,extra\n"):
        (out / funnel.FUNNEL).write_text(bad, encoding="utf-8")
        assert funnel.run(out, DAY, write_answer(tmp_path / "c.json", answer()), None) == "failed"
        assert (out / funnel.FUNNEL).read_text(encoding="utf-8") == bad
        assert not (out / funnel.LINE).exists()


# -- the month on the line ---------------------------------------------------------------


DAY_LINE = ("2026-11-30 (UTC): accounts 12 (new 2), sign-in codes asked for 3, sign-ins 2, Pro 1, saved searches 4, "
            "watches 7; page views by people 120, engaged visitors 7, from search 9, on a phone or tablet 6")
MONTH = ("month 2026-11: page views by people 3,400; engaged visitor-days 210, from search 160, on a phone or tablet 95; "
         "visitor-days 5,100, visits 4,800; search clicks 140, impressions 9,800; Canada 81.2%; "
         "report views/report-2026-11.md")
REPORT_DAY = date(2026, 11, 30)


def test_the_line_has_the_shape_the_daily_check_accepts():
    # The Worker's pattern, as written in site/src/watchdog.ts.
    m = re.search(r"^const FIGURES_RE = /(.+)/;$", WATCHDOG.read_text(encoding="utf-8"), re.M)
    assert m and m.group(1) == funnel.FIGURES_PATTERN
    assert funnel.MONTH_PART_SEP == vrep.PART_SEP
    assert funnel.is_figures_line(DAY_LINE)
    assert funnel.is_figures_line("2026-11-30 (UTC): " + "x" * 600)
    for bad in ("2026-11-30 (UTC): " + "x" * 601, "2026-11-30 (UTC): a\nb", "2026-11-30 (UTC): a\n",
                "2026-11-30 (UTC): café", "2026-11-30: a", "٢026-11-30 (UTC): a", "2026-11-30 (UTC): "):
        assert not funnel.is_figures_line(bad), bad


def test_the_month_is_joined_after_the_days_figures():
    joined = funnel.with_month(DAY_LINE + "\n", MONTH + "\n", REPORT_DAY)
    assert joined == f"{DAY_LINE} | {MONTH}"
    assert funnel.is_figures_line(joined)


def test_without_a_days_line_the_month_goes_on_a_line_dated_as_the_funnel_step_dates_it():
    expected = f"2026-11-30 (UTC): {funnel.NO_DAY} | {MONTH}"
    assert funnel.is_figures_line(expected)
    # No line, or one the daily check would refuse anyway.
    for missing in (None, "", "garbled", "2026-11-30 (UTC): café", DAY_LINE + "\n" + DAY_LINE,
                    "2026-11-30 (UTC): " + "x" * 601):
        assert funnel.with_month(missing, MONTH, REPORT_DAY) == expected, missing


def test_a_line_that_would_not_fit_drops_the_months_parts_from_its_end():
    parts = MONTH.split("; ")
    head = "2026-11-30 (UTC): "
    for keep in range(1, len(parts) + 1):
        # A day's line that leaves room for exactly `keep` parts of the month.
        room = len(" | " + "; ".join(parts[:keep]))
        day_line = head + "a" * (600 - room)
        joined = funnel.with_month(day_line, MONTH, REPORT_DAY)
        assert joined == day_line + " | " + "; ".join(parts[:keep]), keep
        assert len(joined) == len(head) + 600 and funnel.is_figures_line(joined)
    # The day's figures are never cut: with no room for the month's first part, nothing is joined.
    assert funnel.with_month(head + "a" * (600 - len(" | " + parts[0]) + 1), MONTH, REPORT_DAY) is None
    # A part the check would refuse goes, with the parts after it.
    odd = MONTH.replace("Canada 81.2%", "Canada 81.2% ")
    assert funnel.with_month(DAY_LINE, odd, REPORT_DAY) == DAY_LINE + " | " + "; ".join(parts[:4])
    assert funnel.with_month(DAY_LINE, "", REPORT_DAY) is None
    assert funnel.with_month(None, "month 2026-11: café", REPORT_DAY) is None


def test_the_command_joins_the_lines_the_two_steps_left_and_prints_neither(tmp_path, capsys, caplog, monkeypatch):
    caplog.set_level("INFO")
    # Tonight's funnel line and the month's line, from one summary, with figures that must never be printed.
    counts = write_answer(tmp_path / "count.json", answer(
        day="2026-11-30", accounts=7301, accounts_new=7302, codes_requested=7303, sign_ins=7304, pro=7305,
        saved_searches=7306, watches=7307))
    summary = write_summary(tmp_path / "summary.csv", day="2026-11-30", human_pages=7308, unique_visitors=7312,
                            human_visits=7313, engaged_visitors=7309, search_visitors=7310, phone_visitors=7311)
    funnel_dir, report_dir = tmp_path / "funnel", tmp_path / "report"
    funnel_dir.mkdir()
    assert funnel.run(funnel_dir, REPORT_DAY, counts, summary) == "written"
    (funnel_dir / "day.txt").write_text("2026-11-30\n", encoding="utf-8")
    assert vrep.run(report_dir, "2026-11", date(2026, 12, 1), summary) == "written"
    out = report_dir / "figures_line.txt"
    args = ["figures-line", "--month-line", str(report_dir / vrep.MONTH_LINE),
            "--day-line", str(funnel_dir / funnel.LINE), "--day-file", str(funnel_dir / "day.txt"), "--out", str(out)]
    capsys.readouterr()
    assert nightly.main(args) == 0
    printed = capsys.readouterr()
    assert printed.out == "figures-line: the month joined to tonight's line\n"
    for n in range(7301, 7314):
        for shown in (str(n), f"{n:,}"):
            assert shown not in printed.out + printed.err + caplog.text, n
    day_line = (funnel_dir / funnel.LINE).read_text(encoding="utf-8").strip()
    month = (report_dir / vrep.MONTH_LINE).read_text(encoding="utf-8").strip()
    assert out.read_text(encoding="utf-8") == f"{day_line} | {month}\n"
    assert funnel.is_figures_line(out.read_text(encoding="utf-8").strip())
    assert "accounts 7,301" in day_line and "month 2026-11: page views by people 7,308" in month
    # No funnel line tonight: the month still goes, on a line dated by the funnel step's day.
    (funnel_dir / funnel.LINE).unlink()
    assert nightly.main(args) == 0
    assert capsys.readouterr().out == "figures-line: the month joined to a line without the day's figures\n"
    assert out.read_text(encoding="utf-8") == f"2026-11-30 (UTC): {funnel.NO_DAY} | {month}\n"
    # Without the day file, or with one that does not read, the date is yesterday's (UTC), as the funnel step's.
    monkeypatch.setattr(funnel, "previous_day", lambda now=None: date(2026, 12, 4))
    (funnel_dir / "day.txt").write_text("not a date\n", encoding="utf-8")
    for day_file in (funnel_dir / "day.txt", tmp_path / "missing.txt"):
        assert nightly.main(args[:5] + ["--day-file", str(day_file), "--out", str(out)]) == 0
        assert out.read_text(encoding="utf-8").startswith(f"2026-12-04 (UTC): {funnel.NO_DAY} | month 2026-11: ")
    # Nothing to join: exit 1, and no file left for the upload, not even an earlier one.
    for month_line in (tmp_path / "missing.txt", tmp_path / "odd.txt"):
        (tmp_path / "odd.txt").write_text("month 2026-11: café\n", encoding="utf-8")
        out.write_text("an earlier line\n", encoding="utf-8")
        assert nightly.main(["figures-line", "--month-line", str(month_line), "--out", str(out)]) == 1
        assert not out.exists()
    printed = capsys.readouterr()
    assert "caf" not in printed.out + printed.err


# -- the commands -----------------------------------------------------------------------


def test_the_commands_print_the_statement_and_an_outcome_and_never_a_figure(tmp_path, capsys, caplog):
    caplog.set_level("INFO")
    assert nightly.main(["funnel-sql", "--day", "2026-11-10"]) == 0
    assert capsys.readouterr().out == funnel.accounts_sql(DAY) + "\n"
    figures = answer(accounts=7301, accounts_new=7302, codes_requested=7303, sign_ins=7304, pro=7305,
                     saved_searches=7306, watches=7307)
    counts = write_answer(tmp_path / "count.json", figures)
    summary = write_summary(tmp_path / "summary.csv", human_pages=7308, engaged_visitors=7309, search_visitors=7310,
                            phone_visitors=7311)
    out = tmp_path / "out"
    assert nightly.main(["funnel", "--day", "2026-11-10", "--accounts", str(counts), "--summary", str(summary),
                         "--out", str(out)]) == 0
    printed = capsys.readouterr()
    assert printed.out == "funnel: written\n"
    for n in range(7301, 7312):
        for shown in (str(n), f"{n:,}"):
            assert shown not in printed.out + printed.err + caplog.text, n
    assert (out / funnel.OUTCOME).read_text(encoding="utf-8") == "written\n"
    assert "7,301" in (out / funnel.LINE).read_text(encoding="utf-8")
    (out / funnel.FUNNEL).write_text("date,email\n", encoding="utf-8")
    assert nightly.main(["funnel", "--day", "2026-11-10", "--out", str(out)]) == 1
    assert (out / funnel.OUTCOME).read_text(encoding="utf-8") == "failed\n"


def test_the_run_status_carries_the_outcome_word_and_a_failed_save_is_a_notice(tmp_path):
    db = tmp_path / "none.sqlite"
    assert nightly.run_status(db, None, None, {})["funnel"] == "not run"
    for word in ("saved", "not run"):
        status = nightly.run_status(db, None, None, {}, funnel=word)
        assert status["funnel"] == word and not any(n["source"] == "funnel" for n in status["notices"])
    status = nightly.run_status(db, None, None, {}, funnel="failed")
    assert {"source": "funnel", "detail": nightly.FUNNEL_NOTICE} in status["notices"]
    assert resilience.attention_items({**status, "stages": []}) == []
    (tmp_path / "funnel.txt").write_text("saved\n", encoding="utf-8")
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(db), "--funnel-outcome", str(tmp_path / "funnel.txt"),
                         "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["funnel"] == "saved"


# -- the workflow: counted in D1, kept in the private prefix, never in a public file ----


def step(text: str, name: str) -> str:
    return text.split(f"- name: {name}", 1)[1].split("\n      - ", 1)[0]


def code(block: str) -> str:
    return "\n".join(ln for ln in block.splitlines() if not ln.lstrip().startswith("#"))


def test_the_workflow_counts_the_funnel_in_d1_and_keeps_it_in_the_private_prefix():
    text = WORKFLOW.read_text(encoding="utf-8")
    count = step(text, "Count the account funnel")
    assert "working-directory: site" in count and "continue-on-error: true" in count and "if: ${{ !cancelled() }}" in count
    assert 'date -u -d yesterday +%Y-%m-%d > "$out/day.txt"' in count
    assert 'sql=$(python -m awardwatch_pipeline.nightly funnel-sql --day "$(cat "$out/day.txt")")' in count
    assert ('"$WRANGLER" d1 execute awardwatch-accounts --remote --json --command "$sql" > "$out/answer.json" '
            '2> "$out/count.log"') in count
    assert 'mv "$out/answer.json" "$out/count.json"' in count
    save = step(text, "Save the account funnel to R2 (private)")
    assert "continue-on-error: true" in save and "if: ${{ !cancelled() }}" in save
    assert ('python -m awardwatch_pipeline.nightly funnel --day "$(cat "$out/day.txt")" --accounts "$out/count.json" '
            '--summary data/out/views/summary.csv --out "$out"') in save
    puts = re.findall(r'r2 object put --remote "\$BUCKET/([^"]+)"', save)
    assert puts == ["views/funnel.csv", "views/funnel_line.txt"]
    # "failed" until both files are in R2.
    assert save.index('echo "failed" > "$out/last_outcome.txt"') < save.index("views/funnel_line.txt") < save.index(
        'echo "saved" > "$out/last_outcome.txt"')
    # Neither step shows a figure in the public log: no answer, record or line is printed.
    for block in (code(count), code(save)):
        for shown in ('cat "$out/count.json', 'cat "$out/answer.json', 'cat "$out/funnel', "cat data/out/funnel",
                      "$GITHUB_STEP_SUMMARY"):
            assert shown not in block, shown
    # After the roll-up wrote tonight's summary, before the run status, which reads only the outcome word.
    names = [ln.strip()[len("- name: "):] for ln in text.splitlines() if ln.strip().startswith("- name: ")]
    assert (names.index("Roll up the audience counts (only when CLOUDFLARE_ANALYTICS_TOKEN is set)")
            < names.index("Count the account funnel") < names.index("Save the account funnel to R2 (private)")
            < names.index("Write the run status"))
    assert "--funnel-outcome data/out/funnel/last_outcome.txt" in step(text, "Write the run status")
    # The record of the run, committed to the public repository, never names the funnel.
    record = step(text, "Record the run so the schedule stays enabled")
    assert "funnel" not in record
    # The funnel's files are read and written in these two steps and, for the
    # month's figures, the report step (the next test), and in no other.
    report = step(text, "Write the monthly audience report (the first run of a month)")
    others = code(text.replace(count, "").replace(save, "").replace(report, ""))
    assert "data/out/funnel/" not in others.replace("--funnel-outcome data/out/funnel/last_outcome.txt", "")
    assert "funnel_line" not in others and "funnel.csv" not in others and "awardwatch-accounts" not in others


def test_the_report_step_puts_the_month_on_the_line_and_prints_neither():
    text = WORKFLOW.read_text(encoding="utf-8")
    report = code(step(text, "Write the monthly audience report (the first run of a month)"))
    assert 'if python -m awardwatch_pipeline.nightly figures-line --month-line "$out/month_line.txt" \\' in report
    assert ('--day-line data/out/funnel/funnel_line.txt --day-file data/out/funnel/day.txt '
            '--out "$out/figures_line.txt" \\') in report
    # The report, then the joined line over the funnel step's, and no answer from Wrangler in the log.
    puts = re.findall(r'r2 object put --remote "\$BUCKET/([^"]+)" --file "([^"]+)"(.*)$', report, re.M)
    assert puts == [("views/report-$month.md", "$out/report-$month.md", " > /dev/null"),
                    ("views/funnel_line.txt", "$out/figures_line.txt", " > /dev/null; then")]
    # Only on the night the report is written, after it is in R2; a join or an
    # upload that fails sits inside the if, so the outcome stays "written".
    assert (report.index('if [ "$outcome" = "written" ]; then') < report.index('"$BUCKET/views/report-$month.md"')
            < report.index("figures-line") < report.index('echo "$outcome" > "$out/last_outcome.txt"'))
    assert "funnel.csv" not in report and "data/out/funnel/" not in report.replace(
        "data/out/funnel/funnel_line.txt", "").replace("data/out/funnel/day.txt", "")
    for shown in ("month_line", "figures_line", "funnel_line", "data/out/funnel"):
        assert f"cat {shown}" not in report and f'cat "$out/{shown}' not in report, shown
    assert "$GITHUB_STEP_SUMMARY" not in report
    # After the funnel step left tonight's line, before the run status.
    names = [ln.strip()[len("- name: "):] for ln in text.splitlines() if ln.strip().startswith("- name: ")]
    assert (names.index("Save the account funnel to R2 (private)")
            < names.index("Write the monthly audience report (the first run of a month)")
            < names.index("Write the run status"))
    # LAST_RUN.md gets the public line alone.
    record = code(step(text, "Record the run so the schedule stays enabled"))
    assert 'echo "Audience report: $(cat data/out/report/summary_line.txt)" >> LAST_RUN.md' in record
    assert "month_line" not in record and "figures_line" not in record
