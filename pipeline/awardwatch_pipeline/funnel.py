"""The account funnel's daily figures, kept for the operator and nobody else.

Why: the accounts database (awardwatch-accounts, site/accounts_schema.sql)
is read by the site alone, so how many people make an account, ask for a
sign-in code and sign in was known only by asking for it. Once a night the
workflow step "Count the account funnel" asks D1 for counts and nothing else
(accounts_sql: no address, no id, no row leaves the database), and this
module keeps them: one row per finished UTC day in views/funnel.csv, and the
day's line, with that day's audience figures from views/summary.csv
(views_rollup.py), in views/funnel_line.txt. The workflow puts both under
the private views/ prefix in R2, which no route on the site reads, and the
Worker's daily check (site/src/watchdog.ts) adds the line to the operator's
email.

Where the figures never go: LAST_RUN.md, which the nightly commits to the
public repository; the run status, which the run prints in its public log;
the log itself. Nothing here prints or logs a figure, only how many of the
counts could be read.

What a row holds: for the day (UTC), the accounts made, the sign-in codes
asked for (audit event code_requested) and the sign-ins (signed_in); then
four levels read when the nightly ran, the day after: active accounts,
accounts whose plan is Pro (the operator console's count, PRO_SQL), saved
searches and watches. The audit trail keeps 90 days, so a day's codes and
sign-ins can be counted again only within them.

A count that cannot be read is blank in the row and "n/a" in the line,
never 0. A night run again (a retry the same day) replaces that day's row,
and a count it could not read keeps the one the row had, as the roll-up does
with its readings.

The month on the line (with_month): on the night the monthly audience
report is written (views_report.py), the report step joins the month's
private line to the day's line and puts the result in R2 again, so the
morning's email carries the month once. The joined line keeps the shape the
daily check accepts (FIGURES_PATTERN): the day's figures stay whole, and the
month's parts are dropped from its end until the line fits. A night whose
funnel step left no line still gets one, dated as that step dates it. A
retry the same day writes the day's line alone again and finds the report
already written, so the month is then in the report only.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .views_rollup import SummaryError, _write_csv, read_summary

log = logging.getLogger(__name__)

FUNNEL = "funnel.csv"
LINE = "funnel_line.txt"
OUTCOME = "outcome.txt"

# New columns go at the end, as in the roll-up's summary.
HEADER = ["date", "accounts", "accounts_new", "codes_requested", "sign_ins", "pro", "saved_searches", "watches"]
COUNTS = HEADER[1:]
# The day's audience figures the line carries, from the roll-up's summary row.
AUDIENCE = ["human_pages", "engaged_visitors", "search_visitors", "phone_visitors"]

# The line the Worker's daily check accepts (site/src/watchdog.ts, FIGURES_RE,
# the same text; a test holds the two together): the date, " (UTC): ", then
# at most 600 printable ASCII characters on one line. Matched with ASCII
# digits and fullmatch, as JavaScript reads it.
FIGURES_PATTERN = r"^(\d{4}-\d{2}-\d{2}) \(UTC\): [ -~]{1,600}$"
# Between the day's figures and the month's, and between the month's parts
# (views_report.PART_SEP, most wanted first).
MONTH_SEP = " | "
MONTH_PART_SEP = "; "
NO_DAY = "the day's figures were not written tonight"

# The operator console's count of accounts on a paid plan (site/src/account/admin_ops.ts,
# overview, without its split by plan and source): of each active account's live
# entitlements, the latest by created_at then id, when its plan is pro. An Ultra
# account's deciding row is a pro row with a tier row beside it, in a table the
# funnel does not read (it may not exist yet), so Pro here holds Ultra too.
# "Now" is written as toISOString writes the stored times, so they compare as
# text. A test holds the two statements together.
NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
PRO_SQL = (
    "SELECT COUNT(*) FROM (SELECT e.plan, ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at DESC, "
    "e.id DESC) AS r FROM entitlements e JOIN users u ON u.id = e.user_id AND u.status = 'active' "
    f"WHERE e.revoked_at IS NULL AND e.starts_at <= {NOW} AND (e.ends_at IS NULL OR e.ends_at > {NOW})) "
    "WHERE r = 1 AND plan = 'pro'"
)


def accounts_sql(day: date) -> str:
    """One statement, one row: the day it counts, then the seven counts in HEADER's order.

    The times in the accounts database are toISOString text
    (2026-11-10T12:34:56.789Z), so the bare dates of the day and the next
    bound it as text. The dates come from a date object, never from input."""
    start, end = day.isoformat(), (day + timedelta(days=1)).isoformat()

    def within(column: str) -> str:
        return f"{column} >= '{start}' AND {column} < '{end}'"

    return (
        f"SELECT '{start}' AS day, "
        "(SELECT COUNT(*) FROM users WHERE status = 'active') AS accounts, "
        f"(SELECT COUNT(*) FROM users WHERE {within('created_at')}) AS accounts_new, "
        f"(SELECT COUNT(*) FROM audit WHERE event = 'code_requested' AND {within('at')}) AS codes_requested, "
        f"(SELECT COUNT(*) FROM audit WHERE event = 'signed_in' AND {within('at')}) AS sign_ins, "
        f"({PRO_SQL}) AS pro, "
        "(SELECT COUNT(*) FROM saved_searches) AS saved_searches, "
        "(SELECT COUNT(*) FROM watches) AS watches"
    )


def _whole(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def account_counts(data: Any, day: date) -> dict[str, int | None] | None:
    """The counts in Wrangler's answer to accounts_sql (`d1 execute --json`: a
    list holding one result whose rows are [{day, accounts, ...}]), each None
    where it does not read; None when it is not that answer for that day."""
    if isinstance(data, list):
        data = data[0] if len(data) == 1 else None
    if not isinstance(data, dict) or data.get("success") is False:
        return None
    rows = data.get("results")
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        return None
    row = rows[0]
    if row.get("day") != day.isoformat():
        return None
    return {column: _whole(row.get(column)) for column in COUNTS}


def read_account_counts(path: Path | None, day: date) -> dict[str, int | None] | None:
    """The counts in the file the count step wrote, or None when it is missing
    or does not read. Anything Wrangler prints before its JSON is skipped."""
    try:
        text = path.read_text(encoding="utf-8") if path is not None and path.is_file() else ""
    except (OSError, UnicodeDecodeError):
        return None
    starts = [i for i in (text.find("["), text.find("{")) if i >= 0]
    if not starts:
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(text, min(starts))
    except ValueError:
        return None
    return account_counts(data, day)


def day_audience(summary: Path | None, day: date) -> dict[str, int | None]:
    """The day's audience figures from the roll-up's summary, None for each one it does not hold."""
    out: dict[str, int | None] = dict.fromkeys(AUDIENCE)
    if summary is None:
        return out
    try:
        rows = read_summary(summary)
    except SummaryError as exc:
        log.warning("funnel: the audience summary cannot be read (%s); the line says n/a for it", exc)
        return out
    row = next((r for r in rows if r["date"] == day.isoformat()), None)
    for column in AUDIENCE:
        text = (row or {}).get(column, "")
        out[column] = int(text) if text.isdigit() else None
    return out


def read_funnel(path: Path) -> list[dict[str, str]]:
    """The record's rows; none when the file does not exist (the first night).

    Raises ValueError when it exists but has a column this code does not
    know or a row whose date does not read: replacing it would lose the
    record, so the step fails instead."""
    if not path.exists():
        return []
    reader = csv.DictReader(io.StringIO(path.read_text(encoding="utf-8")))
    header = reader.fieldnames or []
    if "date" not in header or any(c not in HEADER for c in header):
        raise ValueError(f"{path.name} has an unexpected header: {','.join(header)[:200]}")
    rows = []
    for row in reader:
        stamp = row.get("date") or ""
        try:
            date.fromisoformat(stamp)
        except ValueError:
            raise ValueError(f"{path.name} has a malformed row near {stamp[:20]!r}") from None
        if None in row or len(stamp) != 10:
            raise ValueError(f"{path.name} has a malformed row near {stamp[:20]!r}")
        rows.append({k: (row.get(k) or "") for k in HEADER})
    return rows


def merge(rows: list[dict[str, Any]], new: dict[str, Any]) -> list[dict[str, Any]]:
    """rows with new put in place of its day's row, sorted by date. A count new
    lacks keeps the value the day's row had."""
    by_date = {r["date"]: r for r in rows}
    old = by_date.get(new["date"], {})
    by_date[new["date"]] = {k: (new.get(k) if new.get(k) not in ("", None) else old.get(k, "")) for k in HEADER}
    return [by_date[k] for k in sorted(by_date)]


def _n(value: Any) -> str:
    text = "" if value is None else str(value)
    return f"{int(text):,}" if text.isdigit() else "n/a"


def line(row: dict[str, Any], audience: dict[str, int | None]) -> str:
    """The day's line for the operator's email; n/a for a figure not read."""
    return (f"{row['date']} (UTC): accounts {_n(row.get('accounts'))} (new {_n(row.get('accounts_new'))}), "
            f"sign-in codes asked for {_n(row.get('codes_requested'))}, sign-ins {_n(row.get('sign_ins'))}, "
            f"Pro {_n(row.get('pro'))}, saved searches {_n(row.get('saved_searches'))}, "
            f"watches {_n(row.get('watches'))}; page views by people {_n(audience.get('human_pages'))}, "
            f"engaged visitors {_n(audience.get('engaged_visitors'))}, "
            f"from search {_n(audience.get('search_visitors'))}, "
            f"on a phone or tablet {_n(audience.get('phone_visitors'))}")


def is_figures_line(text: str) -> bool:
    """Whether the daily check would accept text as the figures line (its date aside)."""
    return re.fullmatch(FIGURES_PATTERN, text, re.ASCII) is not None


def with_month(day_line: str | None, month_line: str, day: date) -> str | None:
    """The figures line with the month's line joined on, for views/funnel_line.txt.

    day_line is the line the funnel step left tonight; one the daily check
    would not accept counts as none. Without one, the line is dated day (the
    day the funnel step counted) and says the day's figures are missing, so
    the email still carries the month. The day's figures are never cut: the
    month's parts go from its end (its key in R2 first, the page views by
    people last) until the line passes the check, so a part that is too long
    or not printable ASCII goes as well. None when not even the first part
    passes: the line R2 holds is then left as it is."""
    head = (day_line or "").strip()
    if not is_figures_line(head):
        head = f"{day.isoformat()} (UTC): {NO_DAY}"
    parts = [p for p in month_line.strip().split(MONTH_PART_SEP) if p]
    while parts:
        joined = head + MONTH_SEP + MONTH_PART_SEP.join(parts)
        if is_figures_line(joined):
            return joined
        parts.pop()
    return None


def previous_day(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc).date() - timedelta(days=1)


def run(out_dir: Path, day: date, accounts: Path | None, summary: Path | None) -> str:
    """Write funnel.csv (the record downloaded into out_dir, with the day's
    row) and funnel_line.txt in out_dir. Returns "written" or "failed"; never
    raises, and never prints or logs a figure."""
    try:
        record = out_dir / FUNNEL
        try:
            rows = read_funnel(record)
        except (OSError, UnicodeDecodeError, ValueError) as exc:
            log.error("funnel: %s; nothing written, and the record is left as it is", exc)
            return "failed"
        counts = read_account_counts(accounts, day)
        audience = day_audience(summary, day)
        new = {"date": day.isoformat(), **{c: "" if counts is None or counts[c] is None else counts[c]
                                           for c in COUNTS}}
        rows = merge(rows, new)
        _write_csv(record, HEADER, rows)
        today = next(r for r in rows if r["date"] == day.isoformat())
        (out_dir / LINE).write_text(line(today, audience) + "\n", encoding="utf-8", newline="\n")
        read = 0 if counts is None else sum(v is not None for v in counts.values())
        log.info("funnel: the row and the line for %s are written (%d of %d account counts read, %d of %d "
                 "audience figures)", day, read, len(COUNTS), sum(v is not None for v in audience.values()),
                 len(AUDIENCE))
        return "written"
    except Exception as exc:
        log.error("funnel failed (%s)", type(exc).__name__)
        return "failed"
