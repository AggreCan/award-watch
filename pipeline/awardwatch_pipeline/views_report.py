"""The monthly audience report, written once per UTC month from the files in R2.

On the first run of a month the workflow finds no `views/report-<YYYY-MM>.md`
for the month just ended in R2 and runs this. It reads `views/summary.csv`
(views_rollup.py) and, when present, `views/search_console.csv`
(search_console.py), and writes the report: the month and the three before
it, side by side, in plain markdown tables, with the definitions of the
numbers and nothing else. It also writes two lines. summary_line.txt is the
one the workflow adds to LAST_RUN.md, which the nightly commits to the public
repository: it says the month's report was written and its R2 key, and holds
no figure. month_line.txt holds the month's figures for the operator: the
workflow joins it to the night's private figures line (funnel.with_month) and
puts the result in R2 as views/funnel_line.txt, so the Worker's daily check
mails the month once, the morning after the report is written. Neither line
is printed or logged.

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
the report says beside the table which figures to read as people. In the
private line those three come right after the page views by people.

The crawler pool (since 2026-11-19): from 2026-11-13 a pool of automated
browsers was counted as people. The Worker now counts it apart (hosted
networks, the closed response form), the table carries those two figures and
people's views of the plans and sign-in pages, and a note under the table
names the days whose people's figures hold the pool (views_rollup.pool_days).
Those days' rows are never rewritten. The table also carries the account
steps from views/funnel.csv: codes asked for, accounts made, first saved
searches or watches.

Search (since 2026-11-19): clicks and impressions by day for the
SEARCH_DAYS days to the newest final day of the month, the pages and queries
that lost the most clicks over its last LOSS_DAYS days against the
LOSS_DAYS before (views/search_pages.csv, views/search_queries.csv), and the
month's last index sample by kind of page (views/index_sample.csv).

Alert sign-ups: the count the nightly run read from the forms database just
before the report (rows of the interest table, one per address and saved
filter, and how many have not unsubscribed; the landing page's Ultra card
rows, which hold no filter, are left out by the workflow's query), as it stood
when the report was written. The report is the only place it is kept; the
run status records only whether it was counted.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlsplit

from .views_rollup import POOL_FIRST_DAY, READER_COLUMNS, SummaryError, day_span, pool_days, read_summary

log = logging.getLogger(__name__)

WAIT_DAYS = 7
MONTHS = 4
TOP_PAGES = 10
NA = "n/a"
# The Search block: clicks and impressions by day for SEARCH_DAYS days, and the pages and queries that lost the
# most clicks over the last LOSS_DAYS days against the LOSS_DAYS before (TOP_LOSSES of each).
SEARCH_DAYS = 28
LOSS_DAYS = 7
TOP_LOSSES = 10
INDEXED = "PASS"

# The public line for LAST_RUN.md (no figure) and the private one for the operator's email.
SUMMARY_LINE = "summary_line.txt"
MONTH_LINE = "month_line.txt"


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
    class_days: int = 0               # days with the classes counted apart (the Worker's rule "2")
    hosted: int = 0                   # page views from hosted networks
    closed: int = 0                   # the response form opened from anywhere but its profile
    plans: int = 0                    # people's views of the plans page
    sign_in: int = 0                  # people's views of the sign-in page
    pool: list[str] = field(default_factory=list)  # days whose people's figures hold the crawler pool
    account_days: int = 0             # days with codes and accounts made read
    codes: int = 0
    accounts_new: int = 0
    first_saves_days: int = 0
    first_saves: int = 0


def gather(month: str, summary: list[dict[str, str]], search: list[dict[str, str]],
           funnel: list[dict[str, str]] | None = None) -> Month:
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
        hosted = _int(row.get("hosted_pages"))
        if hosted is not None:
            m.class_days += 1
            m.hosted += hosted
            m.closed += _int(row.get("closed_pages")) or 0
            m.plans += _int(row.get("plans_pages")) or 0
            m.sign_in += _int(row.get("sign_in_pages")) or 0
    m.pool = [d for d in pool_days(summary) if first.isoformat() <= d <= last.isoformat()]
    for row in funnel or []:
        if not first.isoformat() <= row.get("date", "") <= last.isoformat():
            continue
        codes, new = _int(row.get("codes_requested")), _int(row.get("accounts_new"))
        if codes is not None and new is not None:
            m.account_days += 1
            m.codes += codes
            m.accounts_new += new
        saves = _int(row.get("first_saves"))
        if saves is not None:
            m.first_saves_days += 1
            m.first_saves += saves
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


def pool_text(months: list[Month]) -> str:
    """The note on the days whose people's figures hold the crawler pool, "" when none of the months has one."""
    days = sorted({d for m in months for d in m.pool})
    if not days:
        return ""
    return (f"Days that counted a crawler pool as people: {day_span(days)}. From {POOL_FIRST_DAY.isoformat()} a pool "
            "of automated browsers in data centres was counted as people, tens of thousands of page views a day, until "
            "the Worker counted hosted networks and the closed response form apart. Those days' page views by people, "
            "unique visitors, visits and engaged visitors include it, and they stay as they were counted.\n")


# -- the Search block -------------------------------------------------------------


def _day(text: object) -> date | None:
    try:
        return date.fromisoformat(text) if isinstance(text, str) and len(text) == 10 else None
    except ValueError:
        return None


def _page(url: str) -> str:
    """A page as the report prints it: its path and query, the host only when it is not the apex."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    shown = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    return shown if not host.startswith("www.") else f"www {shown}"


def _cell(text: str) -> str:
    # A table cell holds no pipe and no line break.
    return text.replace("|", "/").replace("\n", " ").strip()


def losses(rows: list[dict[str, str]], key: str, end: date) -> tuple[list[tuple[str, int, int]], int]:
    """The keys that lost the most clicks over the LOSS_DAYS days to end against the LOSS_DAYS before, as (key,
    clicks before, clicks after), most lost first, at most TOP_LOSSES; and how many of the 2 x LOSS_DAYS days the
    rows hold."""
    after = {end - timedelta(days=i) for i in range(LOSS_DAYS)}
    before = {end - timedelta(days=LOSS_DAYS + i) for i in range(LOSS_DAYS)}
    early: dict[str, int] = {}
    late: dict[str, int] = {}
    held: set[date] = set()
    for row in rows:
        day = _day(row.get("date"))
        text = row.get(key) or ""
        if day is None or not text or (day not in before and day not in after):
            continue
        held.add(day)
        side = early if day in before else late
        side[text] = side.get(text, 0) + (_int(row.get("clicks")) or 0)
    lost = [(k, early.get(k, 0), late.get(k, 0)) for k in set(early) | set(late) if early.get(k, 0) > late.get(k, 0)]
    lost.sort(key=lambda r: (r[2] - r[1], r[0]))
    return lost[:TOP_LOSSES], len(held)


def _loss_table(title: str, rows: list[tuple[str, int, int]], held: int, label: str) -> str:
    covered = "" if held == 2 * LOSS_DAYS else f" (the file holds {held} of these {2 * LOSS_DAYS} days)"
    head = f"{title}{covered}:\n\n"
    if not rows:
        return head + "None lost clicks.\n"
    return head + (f"| {label} | Clicks before | Clicks after | Change |\n|---|---:|---:|---:|\n"
                   + "".join(f"| {_cell(k)} | {b:,} | {a:,} | {a - b:,} |\n" for k, b, a in rows))


def index_text(rows: list[dict[str, str]], last: date) -> str:
    """The newest night's index sample up to last: each kind's pages inspected, indexed (verdict PASS), the share,
    and the reasons Google gives for the rest."""
    from .index_sample import SAMPLE

    nights = sorted({r["date"] for r in rows if _day(r.get("date")) is not None and r["date"] <= last.isoformat()})
    if not nights:
        return "No index sample was taken by the month's end.\n"
    night = nights[-1]
    tonight = [r for r in rows if r["date"] == night]
    kinds = [k for k, _ in SAMPLE] + sorted({r.get("kind", "") for r in tonight} - {k for k, _ in SAMPLE})
    lines = []
    for kind in kinds:
        pages = [r for r in tonight if r.get("kind") == kind]
        if not pages:
            continue
        indexed = sum(1 for r in pages if r.get("verdict") == INDEXED)
        reasons: dict[str, int] = {}
        for r in pages:
            if r.get("verdict") != INDEXED:
                why = r.get("coverage") or r.get("verdict") or "no reason given"
                reasons[why] = reasons.get(why, 0) + 1
        why = "; ".join(f"{_cell(k)} {n}" for k, n in sorted(reasons.items(), key=lambda kv: (-kv[1], kv[0]))) or "none"
        lines.append(f"| {kind} | {len(pages)} | {indexed} | {_share(indexed, len(pages))} | {why} |\n")
    month_nights = [n for n in nights if n[:7] == last.isoformat()[:7]]
    return (f"The index sample of {night} ({len(month_nights)} nights sampled this month):\n\n"
            "| Kind of page | Inspected | Indexed | Share indexed | Not indexed, by Google's reason |\n"
            "|---|---:|---:|---:|---|\n" + "".join(lines))


def search_block(month: str, search: list[dict[str, str]], pages: list[dict[str, str]],
                 queries: list[dict[str, str]], index: list[dict[str, str]]) -> str:
    _, last = month_bounds(month)
    held = sorted(d for d in (_day(r.get("date")) for r in search) if d is not None and d <= last)
    if not held:
        return "No Search Console figures were imported for this month.\n\n" + index_text(index, last)
    end = held[-1]
    by_day = {r["date"]: r for r in search}
    days = [end - timedelta(days=i) for i in range(SEARCH_DAYS - 1, -1, -1)]
    table = "| Day | Clicks | Impressions |\n|---|---:|---:|\n" + "".join(
        f"| {d.isoformat()} | {_n(_int(by_day.get(d.isoformat(), {}).get('clicks')) or 0)} | "
        f"{_n(_int(by_day.get(d.isoformat(), {}).get('impressions')) or 0)} |\n" for d in days)
    page_rows, page_days = losses([{**r, "page": _page(r.get("page", ""))} for r in pages], "page", end)
    query_rows, query_days = losses(queries, "query", end)
    span = f"the {LOSS_DAYS} days to {end.isoformat()} against the {LOSS_DAYS} before"
    return (f"Clicks and impressions by day, the {SEARCH_DAYS} days to {end.isoformat()} (the newest final day "
            "imported):\n\n" + table + "\n"
            + _loss_table(f"Pages that lost the most clicks, {span}", page_rows, page_days, "Page") + "\n"
            + _loss_table(f"Queries that lost the most clicks, {span}", query_rows, query_days, "Query") + "\n"
            + index_text(index, last))


def interest_text(interest: dict[str, int] | None) -> str:
    if not interest:
        return "Not counted. The forms database could not be read when this report was written.\n"
    return (f"{_n(interest['n'])} sign-ups when this report was written, {_n(interest['live'])} of them not "
            "unsubscribed. A sign-up is one address with one saved filter, so an address that saved two filters "
            "counts twice.\n")


def render(month: str, months: list[Month], written: date, interest: dict[str, int] | None = None,
           search: str = "") -> str:
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
        line("Days with the classes counted apart", [_days(m.class_days, m.month) for m in months]),
        line("Page views from hosted networks (not people)", [_n(m.hosted) if m.class_days else NA for m in months]),
        line("Response form opened not from its profile (not people)",
             [_n(m.closed) if m.class_days else NA for m in months]),
        line("Plans page views by people", [_n(m.plans) if m.class_days else NA for m in months]),
        line("Sign-in page views by people", [_n(m.sign_in) if m.class_days else NA for m in months]),
        line("Days with account counts", [_days(m.account_days, m.month) for m in months]),
        line("Sign-in codes asked for", [_n(m.codes) if m.account_days else NA for m in months]),
        line("Accounts made", [_n(m.accounts_new) if m.account_days else NA for m in months]),
        line("Accounts with a first saved search or watch",
             [_n(m.first_saves) if m.first_saves_days else NA for m in months]),
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
        f"Written {written.isoformat()} from views/summary.csv, views/search_console.csv and the other files under "
        "views/ in R2. "
        "Months are UTC calendar months. n/a means not counted.\n\n"
        f"## The month and the three before it\n\n{table}\n"
        + (f"{pool_text(months)}\n" if pool_text(months) else "")
        + f"{READING}\n"
        f"## Top pages by people, {month}\n\n{pages}\n"
        f"## Search\n\n{search or search_block(month, [], [], [], [])}\n"
        f"## Alert sign-ups\n\n{interest_text(interest)}\n"
        "## Definitions\n\n"
        "- Days in the roll-up: days with a row in views/summary.csv (a day the Worker counted nothing has none).\n"
        "- Page views by people: responses to page routes below status 400 that the Worker marked human "
        "(not a verified bot, not a crawler or script by its user agent, not a feed poll; from 2026-11-19 not from "
        "a listed hosting network and not the response form opened from anywhere but its profile), summed over the "
        "days with people counted. The bot flag exists from 2026-10-30; earlier days are not counted.\n"
        "- Days with the classes counted apart: days on which every page view was counted under the Worker's rule "
        "of 2026-11-19, which counts two classes apart from people and from bots. Page views from hosted networks: "
        "requests the Worker would otherwise count as a person's that came from one of the large hosting and cloud "
        "networks it lists (site/src/views.ts, HOSTED_ASNS). Response form opened not from its profile: the form "
        "/organizations/:id/respond, which robots.txt closes to every crawler, opened without the organization's "
        "page as the referring page. Neither is in any people's figure.\n"
        "- Plans page and sign-in page views by people: people's page views of /pro and /account/sign-in, counted by "
        "name from 2026-11-19 (before, both were counted under the route \"other\").\n"
        "- Sign-in codes asked for, accounts made: from views/funnel.csv (the accounts database), summed over the "
        "days it holds. Accounts with a first saved search or watch: each day's accounts whose first saved search "
        "or watch, among those they still hold, was made that day (from 2026-11-19).\n"
        "- Search: Search Console's final days as views/search_console.csv holds them (a day with no impressions has "
        "no row and reads 0). The pages and queries are each day's 250 with the most clicks, then impressions "
        "(views/search_pages.csv, views/search_queries.csv, from 2026-11-01); a page or query outside a day's 250 "
        "counts 0 that day, and a query that reads as a person's name is kept as one withheld row. The index "
        "sample (views/index_sample.csv) is the night's Search Console URL Inspection of up to 40 of the site's "
        "pages: open tender notices published in the week, organizations with an award notice in the month, and "
        "published contracts dated in the 90 days, the same pages night after night while they stay in those "
        "windows; indexed means Google's verdict PASS.\n"
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


def report_key(month: str) -> str:
    return f"views/report-{month}.md"


def summary_line(month: str) -> str:
    """The public line for LAST_RUN.md: that the report was written, and where. It takes no figures, so it can
    carry none."""
    return f"{month} written to R2 as {report_key(month)}"


# Between the private line's parts. funnel.with_month drops parts from the end
# to fit the line the daily check accepts, so the most wanted come first.
PART_SEP = "; "


def month_line(month: str, m: Month) -> str:
    """The month's figures in one private line for the operator's email (funnel.with_month joins it to the day's
    line). Page views by people first, then the three counts to read as people, then the visitor-days and visits
    (which count automated browsers too), the search figures, Canada's share and the report's key."""
    readers = m.readers_n > 0
    parts = [
        f"month {month}: page views by people {_n(m.human_pages) if m.people_days else NA}",
        f"engaged visitor-days {_n(m.engaged) if readers else NA}, from search {_n(m.from_search) if readers else NA}, "
        f"on a phone or tablet {_n(m.phone) if readers else NA}",
        f"visitor-days {_n(m.visitor_days) if m.visitor_days_n else NA}, "
        f"visits {_n(m.visits) if m.visitor_days_n else NA}",
        f"search clicks {_n(m.clicks) if m.search_days else NA}, "
        f"impressions {_n(m.impressions) if m.search_days else NA}",
        f"Canada {_share(m.canada, m.countries_total)}",
        f"report {report_key(month)}",
    ]
    return PART_SEP.join(parts)


def _read_search(path: Path | None) -> list[dict[str, str]]:
    """The rows of one of the CSV files under views/ (Search Console's, the funnel's, the index sample's), each
    with a date; none when the file is absent or cannot be read, so a missing file leaves its part n/a."""
    if path is None or not path.exists():
        return []
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    return [r for r in csv.DictReader(io.StringIO(text)) if isinstance(r.get("date"), str) and None not in r]


def run(out_dir: Path, month: str, today: date, summary_path: Path, search_path: Path | None = None,
        interest: dict[str, int] | None = None, *, funnel_path: Path | None = None, pages_path: Path | None = None,
        queries_path: Path | None = None, index_path: Path | None = None) -> str:
    """Write report-<month>.md, summary_line.txt (public, no figure) and month_line.txt (private) in out_dir.
    Returns "written", "waiting" (the month's last day is not rolled up yet), "no data" or "failed"; never
    raises, and never prints or logs a figure. interest is the count of alert sign-ups
    (nightly.interest_counts), None when it was not read. funnel_path, pages_path, queries_path and index_path
    are views/funnel.csv, search_pages.csv, search_queries.csv and index_sample.csv, each optional."""
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
        funnel = _read_search(funnel_path)
        months = [gather(m, summary, search, funnel) for m in previous_months(month)]
        block = search_block(month, search, _read_search(pages_path), _read_search(queries_path),
                             _read_search(index_path))
        out_dir.mkdir(parents=True, exist_ok=True)
        report = render(month, months, today, interest, block)
        (out_dir / f"report-{month}.md").write_text(report, encoding="utf-8", newline="\n")
        (out_dir / SUMMARY_LINE).write_text(summary_line(month) + "\n", encoding="utf-8", newline="\n")
        (out_dir / MONTH_LINE).write_text(month_line(month, months[-1]) + "\n", encoding="utf-8", newline="\n")
        return "written"
    except Exception as exc:
        log.error("views report failed (%s): %s", type(exc).__name__, str(exc)[:200])
        return "failed"
