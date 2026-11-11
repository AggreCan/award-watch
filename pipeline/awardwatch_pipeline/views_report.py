"""The monthly audience report, written once per UTC month from the files in R2.

On the first run of a month the workflow finds no `views/report-<YYYY-MM>.md`
for the month just ended in R2 and runs this. It reads `views/summary.csv`
(views_rollup.py) and, when present, `views/search_console.csv`
(search_console.py), and writes the report: the month and the three before
it, side by side, in plain markdown tables, with the definitions of the
numbers and nothing else. It also writes the one line the workflow adds to
LAST_RUN.md.

Waiting: the report is meant to cover the whole month, so it waits while the
summary lacks the month's last day, for up to WAIT_DAYS days into the next
month; after that it is written with the days there are, and the table says
how many days each figure covers. Search Console's newest final days lag two
or three days, so the report's search rows cover the days imported by then
and say so.

Sums of daily figures: unique visitors come from a code that changes every
UTC day, so a month's figure is the sum of daily uniques ("visitor-days"):
a person who came on three days counts three times. The same holds for
visits and for the three reader counts (engaged, from search, phone or
tablet), which are summed over the days that have all three. Levels (feed
subscribers, organizations, records) are not summed: each month shows the
last reading in it (the largest daily figure for feed subscribers).

Unique visitors count automated browsers that copy a browser's headers, so
the report says beside the table which figures to read as people. The one
line for LAST_RUN.md is public and carries none of the three.

Alert sign-ups: the count the nightly run read from the forms database just
before the report (rows of the interest table, one per address and saved
filter, and how many have not unsubscribed; the landing page's Ultra card
rows, which hold no filter, are left out by the workflow's query), as it stood
when the report was written. It stays out of the one-line summary, which goes
to the public LAST_RUN.md.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from .views_rollup import READER_COLUMNS, SummaryError, read_summary

log = logging.getLogger(__name__)

WAIT_DAYS = 7
MONTHS = 4
TOP_PAGES = 10
NA = "n/a"


def month_bounds(month: str) -> tuple[date, date]:
    """First and last day of "YYYY-MM". Raises ValueError."""
    first = date.fromisoformat(f"{month}-01")
    nxt = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    return first, nxt - timedelta(days=1)


def previous_months(month: str, count: int = MONTHS) -> list[str]:
    """count months ending with month, oldest first."""
    first, _ = month_bounds(month)
    out = []
    for _ in range(count):
        out.append(first.strftime("%Y-%m"))
        first = (first - timedelta(days=1)).replace(day=1)
    return out[::-1]


def report_month(today: date) -> str:
    """The month a report is due for on a given day: the one before it."""
    return (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")


def _int(value: str | None) -> int | None:
    try:
        n = int(value or "")
    except ValueError:
        return None
    return n if n >= 0 else None


def _float(value: str | None) -> float | None:
    try:
        n = float(value or "")
    except ValueError:
        return None
    return n if n == n and n >= 0 else None


def _counts(value: str | None) -> dict[str, int] | None:
    try:
        data = json.loads(value or "")
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    return {str(k): v for k, v in data.items() if isinstance(v, int) and not isinstance(v, bool) and v >= 0}


@dataclass
class Month:
    month: str
    days: int = 0                     # days in the summary
    people_days: int = 0              # days with the people columns filled
    human_pages: int = 0
    visitor_days: int = 0
    visitor_days_n: int = 0           # days with a unique-visitor figure
    visits: int = 0
    readers_n: int = 0                # days with all three reader counts
    engaged: int = 0                  # codes with two or more page views, summed by day
    from_search: int = 0              # codes referred by a search engine, summed by day
    phone: int = 0                    # codes on a phone or tablet, summed by day
    canada: int = 0                   # people's page views from CA, on days with countries
    countries_total: int = 0
    devices: dict[str, int] = field(default_factory=dict)
    routes: dict[str, int] = field(default_factory=dict)
    feed_subscribers: int | None = None
    organizations: int | None = None
    records: int | None = None
    search_days: int = 0
    clicks: int = 0
    impressions: int = 0
    position_weight: float = 0.0      # sum of position x impressions


def gather(month: str, summary: list[dict[str, str]], search: list[dict[str, str]]) -> Month:
    first, last = month_bounds(month)
    m = Month(month)
    for row in sorted(summary, key=lambda r: r["date"]):
        if not first.isoformat() <= row["date"] <= last.isoformat():
            continue
        m.days += 1
        pages = _int(row.get("human_pages"))
        if pages is not None:
            m.people_days += 1
            m.human_pages += pages
            countries = _counts(row.get("human_by_country")) or {}
            m.canada += countries.get("CA", 0)
            m.countries_total += sum(countries.values())
            for key, n in (_counts(row.get("human_by_device")) or {}).items():
                m.devices[key] = m.devices.get(key, 0) + n
            for key, n in (_counts(row.get("human_by_route")) or {}).items():
                m.routes[key] = m.routes.get(key, 0) + n
        uniques = _int(row.get("unique_visitors"))
        if uniques is not None:
            m.visitor_days_n += 1
            m.visitor_days += uniques
            m.visits += _int(row.get("human_visits")) or 0
        # Together or not at all, so the three cover the same days and can be
        # read beside each other.
        engaged, from_search, phone = (_int(row.get(c)) for c in READER_COLUMNS)
        if engaged is not None and from_search is not None and phone is not None:
            m.readers_n += 1
            m.engaged += engaged
            m.from_search += from_search
            m.phone += phone
        subs = _int(row.get("feed_subscribers"))
        if subs is not None:
            m.feed_subscribers = subs if m.feed_subscribers is None else max(m.feed_subscribers, subs)
        for attr, column in (("organizations", "organizations"), ("records", "records")):
            value = _int(row.get(column))
            if value is not None:
                setattr(m, attr, value)  # rows run oldest first, so the last reading stands
    for row in search:
        if not first.isoformat() <= row["date"] <= last.isoformat():
            continue
        clicks, impressions, position = _int(row.get("clicks")), _int(row.get("impressions")), _float(row.get("position"))
        if clicks is None or impressions is None:
            continue
        m.search_days += 1
        m.clicks += clicks
        m.impressions += impressions
        m.position_weight += (position or 0.0) * impressions
    return m


def _n(value: int | None) -> str:
    return NA if value is None else f"{value:,}"


def _share(part: int, whole: int) -> str:
    return NA if whole <= 0 else f"{100 * part / whole:.1f}%"


def _days(n: int, month: str) -> str:
    first, last = month_bounds(month)
    return f"{n} of {(last - first).days + 1}"


# What each visitor figure can tell, printed under the table.
READING = (
    "Unique visitors counts every client that sends a browser's headers, and that includes automated browsers that "
    "copy those headers. Engaged visitors, visitors from search and visitors on a phone or tablet are the figures to "
    "read as people. Each undercounts the real audience in its own way: engaged leaves out everyone who read one "
    "page, from search leaves out everyone who came by a link, a bookmark or a typed address, and phone or tablet "
    "leaves out everyone on a desktop.\n"
)


def interest_text(interest: dict[str, int] | None) -> str:
    if not interest:
        return "Not counted. The forms database could not be read when this report was written.\n"
    return (f"{_n(interest['n'])} sign-ups when this report was written, {_n(interest['live'])} of them not "
            "unsubscribed. A sign-up is one address with one saved filter, so an address that saved two filters "
            "counts twice.\n")


def render(month: str, months: list[Month], written: date, interest: dict[str, int] | None = None) -> str:
    cols = [m.month for m in months]
    head = "| Figure | " + " | ".join(cols) + " |\n|---|" + "---:|" * len(cols) + "\n"

    def line(label: str, values: list[str]) -> str:
        return f"| {label} | " + " | ".join(values) + " |\n"

    people = [m.people_days > 0 for m in months]
    table = head + "".join([
        line("Days in the roll-up", [_days(m.days, m.month) for m in months]),
        line("Days with people counted", [_days(m.people_days, m.month) for m in months]),
        line("Page views by people", [_n(m.human_pages) if ok else NA for m, ok in zip(months, people)]),
        line("Days with visitor counts", [_days(m.visitor_days_n, m.month) for m in months]),
        line("Unique visitors (visitor-days)", [_n(m.visitor_days) if m.visitor_days_n else NA for m in months]),
        line("Visits", [_n(m.visits) if m.visitor_days_n else NA for m in months]),
        line("Days with engaged, search and phone counts", [_days(m.readers_n, m.month) for m in months]),
        line("Engaged visitors (visitor-days)", [_n(m.engaged) if m.readers_n else NA for m in months]),
        line("Visitors from search (visitor-days)", [_n(m.from_search) if m.readers_n else NA for m in months]),
        line("Visitors on a phone or tablet (visitor-days)", [_n(m.phone) if m.readers_n else NA for m in months]),
        line("Canada share of people's page views", [_share(m.canada, m.countries_total) for m in months]),
        line("Desktop share", [_share(m.devices.get("desktop", 0), sum(m.devices.values())) for m in months]),
        line("Mobile share", [_share(m.devices.get("mobile", 0), sum(m.devices.values())) for m in months]),
        line("Tablet share", [_share(m.devices.get("tablet", 0), sum(m.devices.values())) for m in months]),
        line("Days with search figures", [_days(m.search_days, m.month) for m in months]),
        line("Search clicks", [_n(m.clicks) if m.search_days else NA for m in months]),
        line("Search impressions", [_n(m.impressions) if m.search_days else NA for m in months]),
        line("Average search position", [f"{m.position_weight / m.impressions:.1f}" if m.impressions else NA
                                         for m in months]),
        line("Feed subscribers (largest daily figure)", [_n(m.feed_subscribers) for m in months]),
        line("Organizations (last reading)", [_n(m.organizations) for m in months]),
        line("Records (last reading)", [_n(m.records) for m in months]),
    ])

    current = months[-1]
    top = sorted(current.routes.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_PAGES]
    total = sum(current.routes.values())
    pages = ("| Route | Page views by people | Share |\n|---|---:|---:|\n"
             + "".join(f"| `{route}` | {n:,} | {_share(n, total)} |\n" for route, n in top)) if top else (
        "No page views by people were counted this month.\n")

    return (
        f"# Award Watch audience report, {month}\n\n"
        f"Written {written.isoformat()} from views/summary.csv and views/search_console.csv in R2. "
        "Months are UTC calendar months. n/a means not counted.\n\n"
        f"## The month and the three before it\n\n{table}\n"
        f"{READING}\n"
        f"## Top pages by people, {month}\n\n{pages}\n"
        f"## Alert sign-ups\n\n{interest_text(interest)}\n"
        "## Definitions\n\n"
        "- Days in the roll-up: days with a row in views/summary.csv (a day the Worker counted nothing has none).\n"
        "- Page views by people: responses to page routes below status 400 that the Worker marked human "
        "(not a verified bot, not a crawler or script by its user agent, not a feed poll), summed over the days "
        "with people counted. The bot flag exists from 2026-10-30; earlier days are not counted.\n"
        "- Unique visitors (visitor-days): each day's count of distinct visitor codes, summed over the month. A code "
        "is a hash of the address and user agent under a key that changes every UTC day, so a person who came on "
        "three days counts three times. Counted only on days when every person's request carried a code.\n"
        "- Visits: each day's count of distinct visitor codes with at least one page view, summed over the month.\n"
        "- Engaged visitors: each day's count of distinct visitor codes with two or more page views below status "
        "400, summed over the days with engaged, search and phone counts.\n"
        "- Visitors from search: each day's count of distinct visitor codes with a page view below status 400 whose "
        "referring site is a search engine (Google, Bing, DuckDuckGo, Yahoo search, Ecosia, Brave Search, Startpage, "
        "Qwant, Yandex, Baidu), summed the same way. A browser that sends no referrer is not counted here.\n"
        "- Visitors on a phone or tablet: each day's count of distinct visitor codes with a page view below status "
        "400 from a device read as mobile or tablet, summed the same way.\n"
        "- Days with engaged, search and phone counts: days on which every person's request carried a code and all "
        "three counts were read. Days rolled up before the three counts existed (2026-11-11) were filled afterwards, "
        "while Analytics Engine still held them.\n"
        "- Canada share, device shares: of people's page views on the days with people counted; the device is read "
        "from the user agent (iPads that ask for desktop pages count as desktop).\n"
        "- Search figures: Google Search Console, web search, final data only, summed over the days imported "
        "(the newest two or three days of a month arrive after it ends). Average position is weighted by "
        "impressions.\n"
        "- Feed subscribers: the largest daily sum of the subscriber counts feed readers stated.\n"
        "- Organizations, records: the last reading taken in the month, the site's counts after the nightly run "
        "(records: award notices, contract history records, published contracts, grant agreements and lobbying "
        "communications, each counted in its own source and the five counts added).\n"
        "- Alert sign-ups: rows of the interest table of the forms database (the \"Get alerts by email\" form and "
        "the Email lists page, not the Ultra card's addresses; one row per address and list, so an address on three "
        "lists counts three times) "
        "read by the nightly run just before this report, and how many of them have no unsubscribe date. A count, "
        "not a monthly figure.\n"
    )


def summary_line(month: str, m: Month) -> str:
    parts = [f"{_n(m.human_pages)} page views by people" if m.people_days else "page views by people n/a",
             f"{_n(m.visitor_days)} visitor-days" if m.visitor_days_n else "visitor-days n/a",
             f"{_n(m.visits)} visits" if m.visitor_days_n else "visits n/a",
             f"Canada {_share(m.canada, m.countries_total)}"]
    if m.search_days:
        parts.append(f"search clicks {_n(m.clicks)}, impressions {_n(m.impressions)}")
    return f"{month}: " + "; ".join(parts) + f" (views/report-{month}.md)"


def _read_search(path: Path | None) -> list[dict[str, str]]:
    if path is None or not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    return [r for r in csv.DictReader(io.StringIO(text)) if isinstance(r.get("date"), str)]


def run(out_dir: Path, month: str, today: date, summary_path: Path, search_path: Path | None = None,
        interest: dict[str, int] | None = None) -> str:
    """Write report-<month>.md and summary_line.txt in out_dir. Returns "written",
    "waiting" (the month's last day is not rolled up yet), "no data" or "failed"; never raises.
    interest is the count of alert sign-ups (nightly.interest_counts), None when it was not read."""
    try:
        first, last = month_bounds(month)
        if today <= last:
            log.error("views report: %s is not over yet", month)
            return "failed"
        try:
            summary = read_summary(summary_path)
        except SummaryError as exc:
            log.error("views report: %s", exc)
            return "failed"
        held = {r["date"] for r in summary}
        if not any(first.isoformat() <= d <= last.isoformat() for d in held):
            log.info("views report: the summary holds no day of %s", month)
            return "no data"
        if last.isoformat() not in held and today <= last + timedelta(days=WAIT_DAYS):
            log.info("views report: %s is not rolled up yet; the report waits", last)
            return "waiting"
        search = _read_search(search_path)
        months = [gather(m, summary, search) for m in previous_months(month)]
        out_dir.mkdir(parents=True, exist_ok=True)
        report = render(month, months, today, interest)
        (out_dir / f"report-{month}.md").write_text(report, encoding="utf-8", newline="\n")
        (out_dir / "summary_line.txt").write_text(summary_line(month, months[-1]) + "\n", encoding="utf-8")
        return "written"
    except Exception as exc:
        log.error("views report failed (%s): %s", type(exc).__name__, str(exc)[:200])
        return "failed"
