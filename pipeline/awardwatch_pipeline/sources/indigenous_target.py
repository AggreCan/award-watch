"""The mandatory minimum 5% Indigenous procurement target: the indigenous_target stage.

Source: Indigenous Services Canada (ISC) on open.canada.ca, Open Government Licence - Canada; the stage reads
the licence on each dataset record and reads nothing from a dataset under another. Federal departments and
agencies report two things to ISC each year, a plan for the next two fiscal years and the result of the year
that ended, and ISC publishes each as a dataset of its own, under a new id every year and at no fixed date:

* the plan ("<fy> and <fy> Planned Procurement ... Mandatory Minimum 5% Indigenous Procurement Target"): a
  planned procurement CSV (per institution and fiscal year, an economic object, its category, the amount that
  may be allocated to it and where the goods or services may be delivered) and a gaps CSV (the economic
  objects where an institution reports an Indigenous business capacity gap). Its planning summary CSV is not
  read: it carries departmental contact names and addresses.
* the results ("Results of the Mandatory Minimum 5% Indigenous Procurement Target for Fiscal Year <fy>"): one
  row per institution, the value awarded to Indigenous businesses (A), to all businesses (B), the deputy head
  approved exceptions (C), the percentage A / (B - C) and whether the target was met. Its contract details CSV
  is not read in this slice.

These are plans and results as the institutions reported them and as ISC published them, and nothing here is
ever added to a contract or agreement value: the tables feed one block of their own in the buyer files
("indigenous_target", buyer_blocks) and nothing else (docs/indigenous-procurement.md).

Finding the datasets (discover). One catalogue search (package_search: organization isc-sac, the phrase
"Indigenous Procurement Target") lists every one with its files, and the newest plan and the newest results are
told by the fiscal years in their titles. When the search does not answer, or lists none of a kind, the known
ids (config.IPT_PLAN_DATASETS, config.IPT_RESULTS_DATASETS, newest first) are read one at a time
(package_show), and the log row says which way each was found. Inside a dataset a file is told by its name in
the record, never by its address: the plan and the gaps files of 2025-26 share one file name.

Reading a file (read_file). UTF-8 with a byte-order mark, or Windows-1252 (the previous plan's two files). The
columns are found by what their headers say (COLUMNS), since the headers changed every year, and a file
lacking a column the stage needs is refused before a row is written. "No Data Provided" in an amount, a
location, a code or a result is kept as not provided, never as zero; a blank as not stated; an amount written
as text ("$1,500,000 ") is kept in cents, and one that is no figure is kept as written.

Institutions to buyers (relink): buyers.resolve on the English and French names, source indigenous_target,
every night, as the other stages do. One the resolver ties to no CKAN or seed buyer is listed in the private
review file, never in the log.

Cadence: the search is read every night (CHECK_HOURS), the datasets coming at no fixed date. A file is
downloaded only when the dataset found is new, the record lists a changed address or last_modified, or the
rules here changed (rules()); the request is conditional on the copy applied, and a copy with the same SHA-256
is not read again.

A search or record that does not read, a dataset missing or under another licence, a file the record does not
list, a download that fails, a column renamed, no row of the fiscal years the dataset covers, or a copy of the
same dataset with far fewer rows (HOLD_FALL): the rows applied before stand, the stage logs a notice and ends
ok, so a yearly source never sets off the retries a failed stage does. A held copy is applied once the operator
writes its SHA-256 (12 characters or more) to config.IPT_RELEASE. Only an exception in this module's own code
fails the stage.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Collection
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit

from .. import config
from ..db import get_meta, hours_since, log_run, now_iso, set_meta
from ..http import AbortRun, FetchError, PoliteClient
from ..normalize import fold_accents, squash
from . import buyers
from .contracts import LayoutError, sha256
from .public_accounts import cents, dollars

log = logging.getLogger(__name__)

SOURCE = "indigenous_target"
# The rows of stats.json "sources" the Data page lists the files under.
STATS_SOURCE = SOURCE
STATS_DEFAULT_FILE = "planned procurement, gaps, results"
REVIEW_FILE = "indigenous-target.txt"

PLAN, GAPS, RESULTS = "plan", "gaps", "results"
PARTS = (PLAN, GAPS, RESULTS)
TABLES = {PLAN: "ipt_plans", GAPS: "ipt_gaps", RESULTS: "ipt_results"}
SAMPLE_NAMES = {PLAN: "ipt-plan.csv", GAPS: "ipt-gaps.csv", RESULTS: "ipt-results.csv"}

# Raised whenever this module reads a row differently (the columns, the no-data words, the amounts): a file
# applied under other rules is read again on the next night.
RULES_VERSION = 1
LICENCE = "ca-ogl-lgo"
PUBLISHER = "isc-sac"
SEARCH_PHRASE = '"Indigenous Procurement Target"'
SEARCH_ROWS = 50
# The search every night: 20 hours, so a run that starts a little earlier than the night before still asks.
CHECK_HOURS = 20
HOLD_FALL = 0.30
TIMEOUT_S = 120
REVIEW_LIST_MAX = 300
# What a buyer file carries at most of one fiscal year's plan rows and of its gaps (site/src/indigenous_target.tsx
# holds the same figures); on 2025-26 the most were 26 plan rows a year and 24 gaps.
IPT_PLAN_ROWS = 200
IPT_GAP_ROWS = 200

META_CHECKED = "indigenous_target:ckan_read_at"
# The copies refused or held, by part: {part: {"why", "dataset", "url", "ckan_modified", "sha256", "rules"}}.
META_HOLD = "indigenous_target:hold"

ROW, GAP, NONE = "row", "gap", "none"
STATED, NOT_PROVIDED, BLANK, TEXT = "stated", "not_provided", "blank", "text"
# What a figure that is not provided is in a buyer file; the site shows it as not provided.
NP = "np"

# The columns each file is read by: (field, its header folded, required). A header is folded (header_key)
# before it is matched whole; the alternatives are the spellings of the files of 2022-23 to 2025-26.
COLUMNS: dict[str, tuple[tuple[str, str, bool], ...]] = {
    PLAN: (
        ("fy", r"fiscal year\b.*", True),
        ("dept_en", r"organization name - en", True),
        ("dept_fr", r"(?:nom de l'organisation|organization name) - fr", True),
        ("acronym_en", r"organization acronym - en", False),
        ("acronym_fr", r"(?:acronyme de l'organisation|organization acr\w*) - fr", False),
        ("code", r"economic object code\b.*", True),
        ("object_en", r"economic object name - en", True),
        ("object_fr", r"(?:nom du code d'article economique|economic object name) - fr", True),
        ("category_en", r"category - en", True),
        ("category_fr", r"(?:categorie|category) - fr", True),
        ("subcategory_en", r"subcategory - en", False),
        ("subcategory_fr", r"(?:sous-categorie|subcategory) - fr", False),
        ("reporting_en", r"reporting object name - en", False),
        ("reporting_fr", r"(?:article de rapport|reporting object name) - fr", False),
        ("amount", r"procurement amount\b.*", True),
        ("delivery_en", r"delivery location of goods and services(?: ?- ?en)?", True),
        ("delivery_fr", r"(?:lieu de livraison des biens et services|delivery location of goods (?:and|et) services) ?- ?fr", True),
    ),
    GAPS: (
        # The gaps file of the 2024-25 plan has no fiscal year: its rows take the dataset's first.
        ("fy", r"fiscal year\b.*", False),
        ("dept_en", r"organization name - en", True),
        ("dept_fr", r"(?:nom de l'organisation|organization name) - fr", True),
        ("acronym_en", r"organization acronym - en", False),
        ("acronym_fr", r"(?:acronyme de l'organisation|organization acr\w*) - fr", False),
        ("code", r"economic object code\b.*", True),
        ("object_en", r"economic object name - en", True),
        ("object_fr", r"(?:nom du code d'article economique|economic object name) - fr", True),
    ),
    RESULTS: (
        ("dept_en", r"organization name(?: - en)?", True),
        ("dept_fr", r"organization name - fr", True),
        ("acronym_en", r"organization acronym(?: - en)?", False),
        ("acronym_fr", r"organization acronym - fr", False),
        ("phase", r"phase", False),
        ("received_en", r"report received(?: - en)?", False),
        ("received_fr", r"report received - fr", False),
        ("a", r"a - .*indigenous business", True),
        ("b", r"b - .*all business", True),
        ("c", r"c - .*exceptions", True),
        ("pct", r"% .*indigenous business\b.*", True),
        ("met_en", r"mee?t 5 ?% target(?: - en)?", True),
        ("met_fr", r"mee?t 5 ?% target(?: -)? fr", True),
        ("fy", r"fiscal year", True),
    ),
}
_COMPILED = {part: tuple((f, re.compile(p), req) for f, p, req in cols) for part, cols in COLUMNS.items()}

# The datasets, by their titles in English.
PLAN_TITLE_RE = re.compile(
    r"^\s*(\d{4})\s*-\s*(\d{2}|\d{4})\s+and\s+(\d{4})\s*-\s*(\d{2}|\d{4})\s+planned\s+procurement\b.*\bindigenous\s+procurement\s+target\b",
    re.I)
RESULTS_TITLE_RE = re.compile(
    r"^\s*results\s+of\s+the\s+mandatory\s+minimum\s+5\s*%\s+indigenous\s+procurement\s+target\s+for\s+fiscal\s+year\s+"
    r"(\d{4})\s*-\s*(\d{2}|\d{4})\b", re.I)
# The files, by their names in the dataset record: (what names one, what rules one out).
FILE_NAMES = {
    PLAN: (re.compile(r"\bplanned\s+procurement\b", re.I), re.compile(r"\b(?:gaps?|summary|dictionary)\b", re.I)),
    GAPS: (re.compile(r"\bgaps?\b", re.I), re.compile(r"\b(?:summary|dictionary)\b", re.I)),
    RESULTS: (re.compile(r"^\s*results\s+of\b", re.I), re.compile(r"\b(?:contract\s+details|dictionary)\b", re.I)),
}
FY_RE = re.compile(r"^\s*(\d{4})\s*[-/]\s*(\d{2}|\d{4})\s*$")
# The buyers table holds the provinces and territories too (CKAN lists each as an organization, "Government
# of Ontario" as on, read 2026-11-13). The files name federal institutions only, so a name that resolves to one
# of them is a wrong match: listed for review, and no block on that government's page.
NOT_FEDERAL_RE = re.compile(r"^\s*government\s+of\b", re.I)


def header_key(text: object) -> str:
    """A header as COLUMNS matches it: accents and case dropped, apostrophes straight, spaces squashed."""
    return " ".join(fold_accents(str(text or "").replace("’", "'")).casefold().split())


def _next_year(first: int, second: str) -> bool:
    return int(second) == (first + 1 if len(second) == 4 else (first + 1) % 100)


def fiscal_year(text: object) -> int | None:
    """'2025-26', '2025-2026' or '2025/2026' -> 2025; None when it is not one year to the next."""
    m = FY_RE.match(str(text or ""))
    if not m or not _next_year(int(m.group(1)), m.group(2)):
        return None
    return int(m.group(1))


def _words(text: object) -> str:
    return header_key(text)


def is_no_data(text: object) -> bool:
    """The publisher's "No Data Provided" (and its French "Aucune donnée n'a été fournie"), alone or both."""
    w = _words(text)
    return w.startswith("no data provided") or w.startswith("aucune donnee n'a ete fournie")


def object_code(text: object) -> str | None:
    """The economic object code as written; None for "No Data Provided", "NIL" or a blank."""
    raw = squash(text)
    if not raw or is_no_data(raw) or _words(raw) == "nil":
        return None
    return raw


def amount(text: object) -> tuple[int | None, str, str | None]:
    """(cents, state, as written): '$1,500,000 ' -> (150000000, stated); "No Data Provided" -> not provided."""
    raw = squash(text)
    if not raw:
        return None, BLANK, None
    if is_no_data(raw):
        return None, NOT_PROVIDED, raw
    value = cents(raw)
    return (value, STATED, raw) if value is not None else (None, TEXT, raw)


def percentage(text: object) -> tuple[float | None, str, str | None]:
    """The published A / (B - C) as a fraction: '0.0647' as written, '6.47%' divided by 100."""
    raw = squash(text)
    if not raw:
        return None, BLANK, None
    if is_no_data(raw):
        return None, NOT_PROVIDED, raw
    body = raw[:-1].strip() if raw.endswith("%") else raw
    try:
        value = Decimal(body.replace(",", ""))
    except InvalidOperation:
        return None, TEXT, raw
    if not value.is_finite():
        return None, TEXT, raw
    return float(value / 100 if raw.endswith("%") else value), STATED, raw


def _text(value: object) -> str | None:
    return squash(value) or None


# ---------------------------------------------------------------------------
# Reading a file
# ---------------------------------------------------------------------------

def decode(raw: bytes) -> tuple[str, str]:
    """The file's text and its encoding: UTF-8 (a byte-order mark dropped), else Windows-1252, in which the
    previous plan's two files are written."""
    try:
        return raw.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace"), "cp1252"


def columns(headers: list[str], part: str, label: str) -> tuple[dict[str, int], list[str]]:
    """field -> its column, and the headers no field reads. LayoutError for a required field no header names,
    or a field two headers name: a renamed column is refused rather than read as another."""
    keys = [header_key(h) for h in headers]
    found: dict[str, int] = {}
    lacking: list[str] = []
    for name, pattern, required in _COMPILED[part]:
        hits = [i for i, k in enumerate(keys) if pattern.fullmatch(k)]
        if len(hits) > 1:
            raise LayoutError(f"{label}: {len(hits)} columns read as {name}; the layout changed")
        if hits:
            found[name] = hits[0]
        elif required:
            lacking.append(name)
    if lacking:
        raise LayoutError(f"{label} lacks the column for {', '.join(lacking)}; the layout changed")
    used = set(found.values())
    return found, [h.strip() for i, h in enumerate(headers) if i not in used and h.strip()]


@dataclass
class Parsed:
    part: str
    encoding: str = "utf-8"
    rows: list[dict] = field(default_factory=list)
    read: int = 0                     # data rows in the file
    skipped: int = 0                  # rows cut short or naming no institution
    other_years: Counter = field(default_factory=Counter)   # rows of a fiscal year the dataset does not cover
    extra: list[str] = field(default_factory=list)

    @property
    def years(self) -> list[int]:
        return sorted({r["fy"] for r in self.rows})


def _plan_row(get, fy: int) -> dict:
    code_raw = get("code")
    names = (get("object_en"), get("object_fr"))
    kind = NONE if is_no_data(code_raw) or (not code_raw and not any(names)) else ROW
    cents_, state, raw = amount(get("amount"))
    d_en, d_fr = get("delivery_en"), get("delivery_fr")
    if not d_en and not d_fr:
        where = (None, None, BLANK)
    elif is_no_data(d_en or d_fr) and (not d_fr or not d_en or is_no_data(d_fr)):
        where = (None, None, NOT_PROVIDED)
    else:
        where = (d_en or None, d_fr or None, STATED)
    return {
        "fy": fy, "kind": kind, "code": object_code(code_raw) if kind == ROW else None,
        "object_en": names[0] or None, "object_fr": names[1] or None,
        "category_en": get("category_en") or None, "category_fr": get("category_fr") or None,
        "subcategory_en": get("subcategory_en") or None, "subcategory_fr": get("subcategory_fr") or None,
        "reporting_en": get("reporting_en") or None, "reporting_fr": get("reporting_fr") or None,
        "amount_cents": cents_, "amount_state": state, "amount_raw": raw,
        "delivery_en": where[0], "delivery_fr": where[1], "delivery_state": where[2],
    }


def _gap_row(get, fy: int) -> dict:
    code = object_code(get("code"))
    return {"fy": fy, "kind": GAP if code else NONE, "code": code,
            "object_en": get("object_en") or None, "object_fr": get("object_fr") or None}


def _result_row(get, fy: int) -> dict:
    out: dict = {"fy": fy, "phase": get("phase") or None, "received_en": get("received_en") or None,
                 "received_fr": get("received_fr") or None, "met_en": get("met_en") or None, "met_fr": get("met_fr") or None}
    for name in ("a", "b", "c"):
        out[f"{name}_cents"], out[f"{name}_state"], out[f"{name}_raw"] = amount(get(name))
    out["pct"], out["pct_state"], out["pct_raw"] = percentage(get("pct"))
    return out


BUILD = {PLAN: _plan_row, GAPS: _gap_row, RESULTS: _result_row}


def read_file(path: Path, part: str, years: tuple[int, ...] = ()) -> Parsed:
    """Every row of one file. years are the fiscal years its dataset covers (none on a samples run, where the
    rows' own years are taken). Raises LayoutError, before a row is kept, for a file lacking a column, with no
    row of those years, or (with no years given) holding more years than its kind can."""
    parsed = Parsed(part=part)
    text, parsed.encoding = decode(path.read_bytes())
    reader = csv.reader(io.StringIO(text, newline=""))
    headers = next(reader, [])
    idx, parsed.extra = columns(headers, part, path.name)
    build = BUILD[part]
    for seq, row in enumerate(reader, start=1):
        if not any(cell.strip() for cell in row):
            continue
        parsed.read += 1
        if len(row) != len(headers):
            parsed.skipped += 1
            continue

        def get(name: str, row: list[str] = row) -> str:
            return squash(row[idx[name]]) if name in idx else ""

        dept = get("dept_en") or get("dept_fr")
        if not dept:
            parsed.skipped += 1
            continue
        if "fy" in idx:
            fy = fiscal_year(get("fy"))
        else:
            fy = years[0] if years else None
        if fy is None or (years and fy not in years):
            parsed.other_years[get("fy") or "none"] += 1
            continue
        rec = build(get, fy)
        rec.update(seq=seq, dept_en=get("dept_en") or get("dept_fr"), dept_fr=get("dept_fr") or None,
                   acronym_en=get("acronym_en") or None, acronym_fr=get("acronym_fr") or None)
        parsed.rows.append(rec)
    if not parsed.rows:
        raise LayoutError(f"{path.name} holds no row of the fiscal years its dataset covers; the previous rows are kept")
    found = parsed.years
    most = 1 if part == RESULTS else 2
    if not years and (len(found) > most or found[-1] - found[0] >= most):
        raise LayoutError(f"{path.name} holds rows of the fiscal years {', '.join(map(str, found))}")
    return parsed


# ---------------------------------------------------------------------------
# Writing a file's rows
# ---------------------------------------------------------------------------

ROW_COLUMNS = {
    PLAN: ("seq", "fy", "kind", "dept_en", "dept_fr", "acronym_en", "acronym_fr", "code", "object_en", "object_fr",
           "category_en", "category_fr", "subcategory_en", "subcategory_fr", "reporting_en", "reporting_fr",
           "amount_cents", "amount_state", "amount_raw", "delivery_en", "delivery_fr", "delivery_state"),
    GAPS: ("seq", "fy", "kind", "dept_en", "dept_fr", "acronym_en", "acronym_fr", "code", "object_en", "object_fr"),
    RESULTS: ("seq", "fy", "dept_en", "dept_fr", "acronym_en", "acronym_fr", "phase", "received_en", "received_fr",
              "a_cents", "a_state", "a_raw", "b_cents", "b_state", "b_raw", "c_cents", "c_state", "c_raw",
              "pct", "pct_state", "pct_raw", "met_en", "met_fr"),
}


@dataclass(frozen=True)
class Resource:
    """A file as its dataset record lists it."""
    part: str
    dataset_id: str
    fy: int                           # the dataset's first fiscal year; 0 on a samples run
    fy_last: int
    resource_id: str
    url: str
    name_en: str | None
    name_fr: str | None
    ckan_modified: str | None
    found: str                        # search | fallback | sample

    @property
    def file(self) -> str:
        return urlsplit(self.url).path.rsplit("/", 1)[-1] or self.url

    @property
    def years(self) -> tuple[int, ...]:
        return tuple(range(self.fy, self.fy_last + 1)) if self.fy else ()


def apply(conn: sqlite3.Connection, parsed: Parsed, res: Resource, *, digest: str, etag: str | None,
          last_modified: str | None, stamp: str) -> Linked:
    """Replace the part's rows with the file's, record the file, and link every row, in one transaction: a fault
    anywhere leaves the rows of the night before."""
    table, cols = TABLES[parsed.part], ROW_COLUMNS[parsed.part]
    years = parsed.years
    try:
        conn.execute(f"DELETE FROM {table}")
        conn.executemany(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                         [tuple(r.get(c) for c in cols) for r in parsed.rows])
        conn.execute("DELETE FROM ipt_files WHERE part = ?", (parsed.part,))
        conn.execute(
            "INSERT INTO ipt_files (part, dataset_id, found, fy, fy_last, resource_id, url, name_en, name_fr, encoding, etag, "
            "last_modified, ckan_modified, sha256, rules, rows, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (parsed.part, res.dataset_id, res.found, res.fy or years[0], res.fy_last or years[-1], res.resource_id, res.url,
             res.name_en, res.name_fr, parsed.encoding, etag, last_modified, res.ckan_modified, digest, rules(), parsed.read, stamp))
        _clear_hold(conn, parsed.part)
        linked = relink(conn, stamp=stamp, commit=False)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return linked


# ---------------------------------------------------------------------------
# Institutions to buyers, computed again every night
# ---------------------------------------------------------------------------

@dataclass
class Linked:
    """What one relink found; the review file's lists."""
    institutions: dict[tuple[str, str | None], str | None] = field(default_factory=dict)
    made: list[tuple[str, str | None, str]] = field(default_factory=list)       # a buyer the resolver made: no CKAN, no seed
    unmapped: list[tuple[str, str | None]] = field(default_factory=list)         # resolved to no buyer
    provincial: list[tuple[str, str | None, str]] = field(default_factory=list) # resolved to a province or territory
    shared: list[tuple[str, str, list[str]]] = field(default_factory=list)       # (part, buyer, institutions): two in one file
    changed: int = 0                  # rows whose buyer moved tonight

    @property
    def mapped(self) -> int:
        """Institutions resolved to a federal buyer CKAN or the seed holds."""
        return sum(1 for bid in self.institutions.values() if bid) - len(self.made) - len(self.provincial)


def not_federal(conn: sqlite3.Connection) -> set[str]:
    """The buyers that are a province's or a territory's government."""
    return {r[0] for r in conn.execute("SELECT id, name_en FROM buyers") if NOT_FEDERAL_RE.match(r[1] or "")}


def relink(conn: sqlite3.Connection, *, stamp: str, commit: bool = True) -> Linked:
    """Every institution's buyer, resolved again from its names; only the rows that changed are written."""
    out = Linked()
    pairs: dict[tuple[str, str | None], None] = {}
    for table in TABLES.values():
        for en, fr in conn.execute(f"SELECT dept_en, dept_fr FROM {table} ORDER BY seq"):
            pairs.setdefault((en, fr), None)
    if not pairs:
        return out
    seeded = {r["buyer_id"] for r in buyers.read_seed()}
    for en, fr in pairs:
        bid = buyers.resolve(conn, en, fr, source=SOURCE, now=stamp)
        out.institutions[(en, fr)] = bid
        if bid is None:
            out.unmapped.append((en, fr))
            continue
        row = conn.execute("SELECT ckan_org, name_en FROM buyers WHERE id = ?", (bid,)).fetchone()
        if row is not None and NOT_FEDERAL_RE.match(row["name_en"] or ""):
            out.provincial.append((en, fr, bid))
            continue
        if (row is None or not row["ckan_org"]) and bid not in seeded:
            out.made.append((en, fr, bid))
    for table in TABLES.values():
        for (en, fr), bid in out.institutions.items():
            cur = conn.execute(f"UPDATE {table} SET buyer_id = ? WHERE dept_en = ? AND dept_fr IS ? AND buyer_id IS NOT ?",
                               (bid, en, fr, bid))
            out.changed += cur.rowcount
    for part, owners in owners_by_part(conn).items():
        out.shared += [(part, bid, sorted(names)) for bid, names in sorted(owners.items()) if len(names) > 1]
    if commit:
        conn.commit()
    return out


# ---------------------------------------------------------------------------
# Finding the datasets
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Dataset:
    kind: str                         # plan | results
    id: str
    fy: int
    fy_last: int
    created: str
    found: str                        # search | fallback
    record: dict = field(compare=False, hash=False, repr=False)


def _title_en(record: dict) -> str:
    titles = record.get("title_translated")
    return squash((titles.get("en") if isinstance(titles, dict) else None) or record.get("title"))


def classify(record: object, found: str) -> Dataset | None:
    """A dataset record as the newest plan or results could be: ISC's, and told by its English title."""
    if not isinstance(record, dict) or not record.get("id"):
        return None
    org = record.get("organization")
    if not isinstance(org, dict) or org.get("name") != PUBLISHER:
        return None
    title = _title_en(record)
    created = str(record.get("metadata_created") or "")
    m = PLAN_TITLE_RE.search(title)
    if m:
        first, second = int(m.group(1)), int(m.group(3))
        if _next_year(first, m.group(2)) and second == first + 1 and _next_year(second, m.group(4)):
            return Dataset(PLAN, str(record["id"]), first, second, created, found, record)
        return None
    m = RESULTS_TITLE_RE.search(title)
    if m and _next_year(int(m.group(1)), m.group(2)):
        return Dataset(RESULTS, str(record["id"]), int(m.group(1)), int(m.group(1)), created, found, record)
    return None


def _newest(datasets: list[Dataset]) -> Dataset | None:
    return max(datasets, key=lambda d: (d.fy, d.fy_last, d.created, d.id)) if datasets else None


CATALOGUE = "{0.scheme}://{0.netloc}/".format(urlsplit(config.CKAN_API))


def search_url() -> str:
    return config.CKAN_PACKAGE_SEARCH.format(q=quote(SEARCH_PHRASE), fq=quote(f"organization:{PUBLISHER}"), rows=SEARCH_ROWS)


def discover(client: PoliteClient, notices: list[str]) -> dict[str, Dataset | None]:
    """The newest plan and the newest results: the catalogue search first, then the known ids one at a time
    for a kind the search did not give. Never raises for the network or the answers (those are notices)."""
    newest: dict[str, Dataset | None] = {PLAN: None, RESULTS: None}
    try:
        answer = client.get_json(search_url(), timeout=60)
        result = answer.get("result") if isinstance(answer, dict) and answer.get("success") else None
        if not isinstance(result, dict) or not isinstance(result.get("results"), list):
            raise ValueError("the search did not answer with a list of records")
        found = [d for d in (classify(r, "search") for r in result["results"]) if d]
        for kind in newest:
            newest[kind] = _newest([d for d in found if d.kind == kind])
    except (FetchError, AbortRun, OSError, ValueError) as exc:
        notices.append(f"indigenous target: the catalogue search could not be read ({_short(exc)}); the known datasets are read")
    for kind, known in ((PLAN, config.IPT_PLAN_DATASETS), (RESULTS, config.IPT_RESULTS_DATASETS)):
        if newest[kind] is not None:
            continue
        for dataset_id in known:
            try:
                answer = client.get_json(config.CKAN_PACKAGE_SHOW.format(dataset=dataset_id), timeout=60)
            except (FetchError, AbortRun, OSError, ValueError):
                continue
            d = classify(answer.get("result") if isinstance(answer, dict) and answer.get("success") else None, "fallback")
            if d is not None and d.kind == kind:
                newest[kind] = d
                notices.append(f"indigenous target: the {kind} dataset was not found by the search; the known dataset "
                               f"{dataset_id} was read")
                break
        else:
            notices.append(f"indigenous target: no {kind} dataset could be found; the rows stand")
    return newest


def resources(dataset: Dataset, notices: list[str]) -> list[Resource]:
    """The dataset's files the stage reads, each told by its name in the record. A dataset under another
    licence gives none, and a part with no file, or two, is a notice."""
    licence = dataset.record.get("license_id")
    if licence != LICENCE:
        notices.append(f"indigenous target: dataset {dataset.id} is under licence {licence!r}, not {LICENCE}; it was not read")
        return []
    parts = (PLAN, GAPS) if dataset.kind == PLAN else (RESULTS,)
    files = []
    for res in dataset.record.get("resources") or []:
        if not isinstance(res, dict):
            continue
        # The search gives an uploaded file's address from the catalogue's root ("/data/dataset/..."), the record
        # itself gives it whole: both are kept whole, so the copy applied matches whichever way it was found.
        url = urljoin(CATALOGUE, str(res.get("url") or ""))
        if urlsplit(url).scheme not in ("http", "https"):
            continue
        fmt = str(res.get("format") or "").strip().upper()
        if fmt != "CSV" and not urlsplit(url).path.lower().endswith(".csv"):
            continue
        if str(res.get("resource_type") or "") == "data_dictionary":
            continue
        names = res.get("name_translated") if isinstance(res.get("name_translated"), dict) else {}
        en = squash(names.get("en") or res.get("name")) or None
        fr = squash(names.get("fr")) or None
        files.append((res, url, en, fr))
    out = []
    for part in parts:
        named, ruled_out = FILE_NAMES[part]
        hits = [f for f in files if f[2] and named.search(f[2]) and not ruled_out.search(f[2])]
        if len(hits) != 1:
            notices.append(f"indigenous target: dataset {dataset.id} lists {len(hits)} files that read as the {part}; "
                           "none was read and the rows stand")
            continue
        res, url, en, fr = hits[0]
        out.append(Resource(part, dataset.id, dataset.fy, dataset.fy_last, str(res.get("id") or ""), url, en, fr,
                            str(res.get("last_modified") or "") or None, dataset.found))
    return out


# ---------------------------------------------------------------------------
# The stage
# ---------------------------------------------------------------------------

def rules() -> str:
    return str(RULES_VERSION)


def released(path: Path | None = None) -> str | None:
    """The SHA-256 (or its first 12 characters or more) the operator wrote to config.IPT_RELEASE, or None."""
    try:
        text = (path or config.IPT_RELEASE).read_text(encoding="utf-8").strip().lower()
    except OSError:
        return None
    token = text.split()[0] if text else ""
    return token if re.fullmatch(r"[0-9a-f]{12,64}", token) else None


@dataclass
class Result:
    states: dict[str, str] = field(default_factory=dict)   # part -> read | unchanged | not due | refused | held | not read
    found: dict[str, Dataset | None] = field(default_factory=dict)
    read: int = 0                     # data rows read tonight
    written: int = 0
    notices: list[str] = field(default_factory=list)
    linked: Linked | None = None

    @property
    def state(self) -> str:
        """read when a part was read tonight; else the first other state, by part."""
        states = [self.states.get(p, "") for p in PARTS]
        if "read" in states:
            return "read"
        return next((s for s in states if s), "unchanged")


def holds(conn: sqlite3.Connection) -> dict[str, dict]:
    try:
        value = json.loads(get_meta(conn, META_HOLD) or "{}")
    except ValueError:
        return {}
    return {k: v for k, v in value.items() if isinstance(v, dict)} if isinstance(value, dict) else {}


def _hold(conn: sqlite3.Connection, part: str, why: str, res: Resource, digest: str | None) -> None:
    held = holds(conn)
    held[part] = {"why": why[:400], "dataset": res.dataset_id, "url": res.url, "ckan_modified": res.ckan_modified,
                  "sha256": digest, "rules": rules()}
    set_meta(conn, META_HOLD, json.dumps(held, sort_keys=True))
    conn.commit()


def _clear_hold(conn: sqlite3.Connection, part: str) -> None:
    held = holds(conn)
    if part in held:
        del held[part]
        set_meta(conn, META_HOLD, json.dumps(held, sort_keys=True))


def _file_row(conn: sqlite3.Connection, part: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM ipt_files WHERE part = ?", (part,)).fetchone()


def _read_copy(conn: sqlite3.Connection, path: Path, res: Resource, result: Result, *, digest: str, etag: str | None,
               last_modified: str | None, stamp: str, release_path: Path | None = None) -> None:
    """Read one copy and apply it, unless its layout is not known or it is held."""
    part = res.part
    try:
        parsed = read_file(path, part, res.years)
    except LayoutError as exc:
        _hold(conn, part, f"layout: {exc}", res, digest)
        result.states[part] = "refused"
        result.notices.append(f"indigenous target: the {part} file {res.file} was not read ({exc}); the rows applied before stand")
        return
    result.read += parsed.read
    if parsed.extra:
        result.notices.append(f"indigenous target: the {part} file has columns the stage does not read: {', '.join(parsed.extra[:10])}")
    if parsed.skipped:
        result.notices.append(f"indigenous target: {parsed.skipped} rows of the {part} file cut short or naming no institution were skipped")
    if parsed.other_years:
        result.notices.append(f"indigenous target: {sum(parsed.other_years.values())} rows of the {part} file of a fiscal year "
                              "its dataset does not cover were skipped")
    applied = _file_row(conn, part)
    previous = conn.execute(f"SELECT COUNT(*) FROM {TABLES[part]}").fetchone()[0] \
        if applied and applied["dataset_id"] == res.dataset_id else 0
    free = released(release_path)
    if previous and len(parsed.rows) < previous * (1 - HOLD_FALL) and not (free and digest.startswith(free)):
        why = (f"{len(parsed.rows)} rows against {previous} in the copy of the same dataset applied before (more than "
               f"{int(HOLD_FALL * 100)} percent fewer)")
        _hold(conn, part, why, res, digest)
        result.states[part] = "held"
        result.notices.append(f"indigenous target: the {part} file (sha256 {digest[:12]}) is held: {why}. The rows applied "
                              f"before stand. Release it by writing {digest[:12]} to awardwatch_pipeline/data/{config.IPT_RELEASE.name}")
        return
    result.linked = apply(conn, parsed, res, digest=digest, etag=etag, last_modified=last_modified, stamp=stamp)
    result.states[part] = "read"
    result.written += len(parsed.rows)


def due(conn: sqlite3.Connection, stamp: str) -> bool:
    age = hours_since(conn, META_CHECKED, now=stamp)
    return age is None or age >= CHECK_HOURS


def _fetch(conn: sqlite3.Connection, client: PoliteClient, res: Resource, result: Result, *, stamp: str,
           work_dir: Path | None, conditional: sqlite3.Row | None) -> None:
    """Download one file (conditional on the copy applied when there is one) and read it when it changed."""
    path = (work_dir or config.WORK_DIR) / f"ipt-{res.part}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        got = client.download_if_changed(res.url, path, etag=conditional["etag"] if conditional else None,
                                         last_modified=conditional["last_modified"] if conditional else None, timeout=TIMEOUT_S)
        if got is None:
            # Not modified: the record changed, the file did not. Nothing is read again.
            conn.execute("UPDATE ipt_files SET ckan_modified = ?, resource_id = ?, found = ? WHERE part = ?",
                         (res.ckan_modified, res.resource_id, res.found, res.part))
            conn.commit()
            result.states[res.part] = "unchanged"
            return
        digest = sha256(path)
        if conditional is not None and conditional["sha256"] == digest and conditional["rules"] == rules():
            conn.execute("UPDATE ipt_files SET ckan_modified = ?, resource_id = ?, found = ?, etag = ?, last_modified = ? "
                         "WHERE part = ?", (res.ckan_modified, res.resource_id, res.found, got.etag, got.last_modified, res.part))
            conn.commit()
            result.states[res.part] = "unchanged"
            return
        _read_copy(conn, path, res, result, digest=digest, etag=got.etag, last_modified=got.last_modified, stamp=stamp)
    finally:
        path.unlink(missing_ok=True)


def _short(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:200]


def _samples(conn: sqlite3.Connection, result: Result, samples: Path, stamp: str) -> None:
    """A samples run: each part's sample file when present, no request."""
    for part in PARTS:
        path = samples / SAMPLE_NAMES[part]
        if not path.exists():
            result.states[part] = "no sample"
            result.notices.append(f"no {SAMPLE_NAMES[part]} in the samples folder (samples run)")
            continue
        digest = sha256(path)
        applied = _file_row(conn, part)
        if applied and applied["url"] == f"samples/{SAMPLE_NAMES[part]}" and applied["sha256"] == digest and applied["rules"] == rules():
            result.states[part] = "unchanged"
            continue
        res = Resource(part, "sample", 0, 0, "sample", f"samples/{SAMPLE_NAMES[part]}", None, None, None, "sample")
        _read_copy(conn, path, res, result, digest=digest, etag=None, last_modified=None, stamp=stamp)


def refresh(conn: sqlite3.Connection, client: PoliteClient | None, result: Result, *, stamp: str,
            samples: Path | None = None, work_dir: Path | None = None) -> None:
    """Read each part's file when it is new, changed or read under other rules; never raises for the network,
    the catalogue or the files (those are notices)."""
    if samples is not None:
        _samples(conn, result, samples, stamp)
        return
    assert client is not None
    current = rules()
    # A file applied under other rules is read again tonight from the address it was read from.
    for row in conn.execute("SELECT * FROM ipt_files WHERE rules IS NOT ? AND found != 'sample' ORDER BY part", (current,)).fetchall():
        res = Resource(row["part"], row["dataset_id"], row["fy"], row["fy_last"], row["resource_id"], row["url"], row["name_en"],
                       row["name_fr"], row["ckan_modified"], row["found"])
        try:
            _fetch(conn, client, res, result, stamp=stamp, work_dir=work_dir, conditional=None)
        except (FetchError, AbortRun, OSError) as exc:
            conn.rollback()
            result.notices.append(f"indigenous target: the {res.part} file could not be read again under new rules ({_short(exc)}); "
                                  "its rows stand as they were read")
    if not due(conn, stamp):
        for part in PARTS:
            result.states.setdefault(part, "not due")
        return
    result.found = discover(client, result.notices)
    set_meta(conn, META_CHECKED, stamp)
    conn.commit()
    files: dict[str, Resource] = {}
    for dataset in result.found.values():
        if dataset is not None:
            files.update((r.part, r) for r in resources(dataset, result.notices))
    held = holds(conn)
    for part in PARTS:
        res = files.get(part)
        if res is None:
            result.states.setdefault(part, "not read")
            continue
        applied = _file_row(conn, part)
        if applied and applied["dataset_id"] == res.dataset_id and applied["url"] == res.url \
                and applied["ckan_modified"] == res.ckan_modified and applied["rules"] == current:
            if applied["found"] != res.found:
                conn.execute("UPDATE ipt_files SET found = ? WHERE part = ?", (res.found, part))
                conn.commit()
            result.states.setdefault(part, "unchanged")
            continue
        hold = held.get(part)
        if hold and hold.get("url") == res.url and hold.get("ckan_modified") == res.ckan_modified and hold.get("rules") == current:
            free = released()
            layout = str(hold.get("why", "")).startswith("layout")
            if layout or not (free and str(hold.get("sha256") or "").startswith(free)):
                result.states[part] = "refused" if layout else "held"
                result.notices.append(f"indigenous target: the {part} file is still {result.states[part]} ({hold.get('why')}); the rows stand")
                continue
        conditional = applied if applied and applied["url"] == res.url and applied["rules"] == current else None
        try:
            _fetch(conn, client, res, result, stamp=stamp, work_dir=work_dir, conditional=conditional)
        except (FetchError, AbortRun, OSError) as exc:
            conn.rollback()
            result.states[part] = "not read"
            result.notices.append(f"indigenous target: the {part} file {res.file} could not be downloaded ({_short(exc)}); the rows stand")


def _fy_label(fy: int | None, last: int | None = None) -> str:
    if not fy:
        return "none"
    one = f"{fy}-{(fy + 1) % 100:02d}"
    return one if not last or last == fy else f"{one}/{last}-{(last + 1) % 100:02d}"


def detail(conn: sqlite3.Connection, result: Result) -> str:
    """The run status line: public, counts only, no name."""
    files = {r["part"]: r for r in conn.execute("SELECT part, fy, fy_last, found FROM ipt_files")}
    linked = result.linked or Linked()
    counts = {p: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for p, t in TABLES.items()}

    def found(part: str) -> str:
        d = result.found.get(PLAN if part != RESULTS else RESULTS)
        how = d.found if d is not None else (files[part]["found"] if part in files else "none")
        return how

    plan, res = files.get(PLAN), files.get(RESULTS)
    held = ",".join(sorted(holds(conn))) or "none"
    return (f"{result.state} plan={_fy_label(plan['fy'] if plan else None, plan['fy_last'] if plan else None)} ({found(PLAN)}) "
            f"results={_fy_label(res['fy'] if res else None)} ({found(RESULTS)}) "
            f"states={','.join(result.states.get(p, '-') for p in PARTS)} rows={counts[PLAN]}/{counts[GAPS]}/{counts[RESULTS]} "
            f"institutions={len(linked.institutions)} mapped={linked.mapped} made={len(linked.made)} "
            f"provincial={len(linked.provincial)} unmapped={len(linked.unmapped)} held={held}")


def run(conn: sqlite3.Connection, client: PoliteClient | None, *, now: str | None = None, samples: Path | None = None,
        work_dir: Path | None = None, review_dir: Path | None = None) -> Result:
    """The indigenous_target stage: each part's file when it changed, then the nightly relink, the review file
    and one log row. A fault of the network or a file is a notice; the stage ends ok."""
    stamp = now or now_iso()
    result = Result()
    buyers.take_notices(conn)
    buyers.take_rejects(conn)
    conn.commit()
    refresh(conn, client, result, stamp=stamp, samples=samples, work_dir=work_dir)
    # Every night, whatever the catalogue said: tonight's buyer merges move the rows.
    try:
        result.linked = relink(conn, stamp=stamp)
    except BaseException:
        conn.rollback()
        raise
    reviewed = write_review(conn, result.linked, (review_dir or config.OUT_DIR / "review") / REVIEW_FILE, stamp=stamp)
    if reviewed and result.state == "read":
        result.notices.append(f"indigenous target: a new file was applied; the review is in {reviewed}")
    made = buyers.take_notices(conn)
    if made:
        result.notices.append(f"{len(made)} buyers not in CKAN or the seed: {'; '.join(made[:15])}")
    buyers.take_rejects(conn)
    line = detail(conn, result)
    log.info("indigenous_target: %s", line)
    log_run(conn, SOURCE, detail=line[:900], rows_in=result.read, rows_new=result.written,
            notice=" | ".join(result.notices) or None)
    return result


# ---------------------------------------------------------------------------
# The review file (private: no step exports or logs it; the nightly saves it to R2's review/ prefix)
# ---------------------------------------------------------------------------

def write_review(conn: sqlite3.Connection, linked: Linked, path: Path, *, stamp: str) -> str | None:
    """The operator's read: the files, the counts, the institutions no listed buyer takes, the holds. The files
    name institutions and economic objects, never a person."""
    files = conn.execute("SELECT * FROM ipt_files ORDER BY part").fetchall()
    if not files:
        path.unlink(missing_ok=True)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    cap = REVIEW_LIST_MAX

    def section(title: str, head: str, items: list[tuple]) -> list[str]:
        lines = ["", f"## {title}: {len(items)}" + (f", the first {cap} listed" if len(items) > cap else ""), f"# {head}"]
        return lines + ["\t".join("" if x is None else str(x) for x in item) for item in items[:cap]]

    out = [f"# The mandatory minimum 5% Indigenous procurement target: the run of {stamp}, rules {rules()}. "
           "For the operator: no step publishes this file.",
           "", "## Files applied", "# part\tdataset\tfound\tfiscal years\tencoding\tsha256\trows\tapplied_at\tckan_modified\tfile"]
    out += [f"{f['part']}\t{f['dataset_id']}\t{f['found']}\t{_fy_label(f['fy'], f['fy_last'])}\t{f['encoding']}\t"
            f"{(f['sha256'] or '')[:12]}\t{f['rows']}\t{f['applied_at']}\t{f['ckan_modified'] or ''}\t{f['url'].rsplit('/', 1)[-1]}"
            for f in files]
    for part, hold in sorted(holds(conn).items()):
        out += ["", f"## {part} held or refused: {hold.get('why')} (sha256 {str(hold.get('sha256') or '')[:12]}, {hold.get('url')})"]
    out += ["", "## Rows", "# table\trows\tby kind or state"]
    out.append("plan\t" + str(conn.execute("SELECT COUNT(*) FROM ipt_plans").fetchone()[0]) + "\t" + ", ".join(
        f"{k} {n}" for k, n in conn.execute("SELECT kind || '/' || amount_state, COUNT(*) FROM ipt_plans GROUP BY 1 ORDER BY 1")))
    out.append("gaps\t" + str(conn.execute("SELECT COUNT(*) FROM ipt_gaps").fetchone()[0]) + "\t" + ", ".join(
        f"{k} {n}" for k, n in conn.execute("SELECT kind, COUNT(*) FROM ipt_gaps GROUP BY 1 ORDER BY 1")))
    out.append("results\t" + str(conn.execute("SELECT COUNT(*) FROM ipt_results").fetchone()[0]) + "\t" + ", ".join(
        f"met {k} {n}" for k, n in conn.execute("SELECT COALESCE(met_en, ''), COUNT(*) FROM ipt_results GROUP BY 1 ORDER BY 1")))
    out += ["", f"## Institutions: {len(linked.institutions)}, {linked.mapped} to a federal CKAN or seed buyer, {len(linked.made)} "
            f"to a buyer the resolver made, {len(linked.provincial)} to a province or territory, {len(linked.unmapped)} to none"]
    out += section("Institutions the resolver made a buyer for (no CKAN organization, no seed row): a buyers.csv row "
                   "ties one to its open.canada.ca organization when it has one", "institution\tFrench\tbuyer id", linked.made)
    out += section("Institutions that resolved to a province's or a territory's government, a wrong match (no block is "
                   "written for it): a buyers.csv row ties one to its federal buyer", "institution\tFrench\tbuyer id", linked.provincial)
    out += section("Institutions that resolved to no buyer", "institution\tFrench", linked.unmapped)
    out += section("Buyers two institutions of one file resolve to (that file's part of the block is left out)",
                   "file\tbuyer id\tinstitutions", [(part, bid, "; ".join(ns)) for part, bid, ns in linked.shared])
    path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    try:
        return path.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


# ---------------------------------------------------------------------------
# What the export writes (export_static calls these, each guarded)
# ---------------------------------------------------------------------------

def figure(cents_value: int | None, state: str, raw: str | None) -> int | float | str | None:
    """An amount as a buyer file writes it: dollars when stated, "np" when not provided, the text as written
    when it is no figure, null when blank."""
    if state == STATED:
        return dollars(cents_value)
    if state == NOT_PROVIDED:
        return NP
    if state == TEXT:
        return (raw or "")[:80]
    return None


def _pair(en: str | None, fr: str | None) -> list | None:
    if not en and not fr:
        return None
    return [en or fr, fr if fr and fr != (en or fr) else None]


def owners_by_part(conn: sqlite3.Connection) -> dict[str, dict[str, set[str]]]:
    """For each file, the institutions (English names) each buyer is resolved from."""
    out: dict[str, dict[str, set[str]]] = {}
    for part, table in TABLES.items():
        owners: dict[str, set[str]] = defaultdict(set)
        for bid, en in conn.execute(f"SELECT DISTINCT buyer_id, dept_en FROM {table} WHERE buyer_id IS NOT NULL"):
            owners[bid].add(en)
        out[part] = owners
    return out


def buyer_blocks(conn: sqlite3.Connection, *, listed: Collection) -> dict[str, dict]:
    """The "indigenous_target" block of each listed buyer an institution of the files resolves to: the newest
    plan's rows by fiscal year, its gaps by fiscal year and its newest result, each with its dataset and fiscal
    years. A part of a buyer two institutions of the same file resolve to is left out: which one's figures to
    show is not the export's to choose. A province or a territory gets none (NOT_FEDERAL_RE)."""
    files = {r["part"]: r for r in conn.execute("SELECT * FROM ipt_files")}
    if not files:
        return {}
    provinces = not_federal(conn)
    keep = {part: {bid for bid, names in owners.items() if len(names) == 1 and bid in listed and bid not in provinces}
            for part, owners in owners_by_part(conn).items()}
    blocks: dict[str, dict] = {}
    objects: dict[str, dict[str, list]] = defaultdict(dict)

    def block(bid: str) -> dict:
        return blocks.setdefault(bid, {"v": 1})

    plan = files.get(PLAN)
    if plan is not None:
        years: dict[str, dict[int, dict]] = defaultdict(dict)
        for r in conn.execute(
                "SELECT * FROM ipt_plans WHERE buyer_id IS NOT NULL ORDER BY buyer_id, fy, kind, category_en COLLATE NOCASE, "
                "amount_cents IS NULL, amount_cents DESC, seq"):
            bid = r["buyer_id"]
            if bid not in keep[PLAN]:
                continue
            year = years[bid].setdefault(r["fy"], {"fy": r["fy"], "n": 0, "rows": []})
            if r["kind"] == NONE:
                year["np"] = 1
                continue
            key = r["code"] or f"r{r['seq']}"
            objects[bid].setdefault(key, [r["object_en"], r["object_fr"], r["category_en"], r["category_fr"]])
            year["n"] += 1
            if len(year["rows"]) < IPT_PLAN_ROWS:
                where = _pair(r["delivery_en"], r["delivery_fr"]) if r["delivery_state"] == STATED else (
                    NP if r["delivery_state"] == NOT_PROVIDED else None)
                year["rows"].append([key, figure(r["amount_cents"], r["amount_state"], r["amount_raw"]), where])
        for bid, by_fy in years.items():
            out = []
            for fy in sorted(by_fy):
                y = by_fy[fy]
                if y["rows"]:
                    y.pop("np", None)
                out.append(y)
            block(bid)["plan"] = {"ds": plan["dataset_id"], "fy": [plan["fy"], plan["fy_last"]], "years": out}
    gaps = files.get(GAPS)
    if gaps is not None:
        found: dict[str, dict[int, dict]] = defaultdict(dict)
        for r in conn.execute("SELECT * FROM ipt_gaps WHERE buyer_id IS NOT NULL "
                              "ORDER BY buyer_id, fy, kind, object_en COLLATE NOCASE, seq"):
            bid = r["buyer_id"]
            if bid not in keep[GAPS]:
                continue
            g = found[bid].setdefault(r["fy"], {"fy": r["fy"], "n": 0, "keys": [], "none": None})
            if r["kind"] == NONE:
                g["none"] = [r["object_en"], r["object_fr"]]
                continue
            key = r["code"] or f"g{r['seq']}"
            have = objects[bid].get(key)
            # The plan's names for the same code when they are the gaps file's own (so on 2025-26), else an entry
            # of the gap's own: each list shows the names its own file gives.
            if have is not None and have[:2] != [r["object_en"], r["object_fr"]]:
                key = f"g{key}"
            objects[bid].setdefault(key, [r["object_en"], r["object_fr"], None, None])
            g["n"] += 1
            if len(g["keys"]) < IPT_GAP_ROWS:
                g["keys"].append(key)
        for bid, by_fy in found.items():
            block(bid)["gaps"] = {"ds": gaps["dataset_id"], "years": [by_fy[fy] for fy in sorted(by_fy)]}
    results = files.get(RESULTS)
    if results is not None:
        for r in conn.execute("SELECT * FROM ipt_results WHERE buyer_id IS NOT NULL ORDER BY buyer_id, fy DESC, seq"):
            bid = r["buyer_id"]
            if bid not in keep[RESULTS] or "result" in blocks.get(bid, {}):
                continue
            met = NP if is_no_data(r["met_en"] or r["met_fr"]) else _pair(r["met_en"], r["met_fr"])
            res = {"ds": results["dataset_id"], "fy": r["fy"], "a": figure(r["a_cents"], r["a_state"], r["a_raw"]),
                   "b": figure(r["b_cents"], r["b_state"], r["b_raw"]), "c": figure(r["c_cents"], r["c_state"], r["c_raw"]),
                   "pct": r["pct"] if r["pct_state"] == STATED else figure(None, r["pct_state"], r["pct_raw"]), "met": met}
            received = r["received_en"] or r["received_fr"]
            # The report's receipt shows only where the file says it was not received.
            if received and _words(received) not in ("yes", "oui"):
                res["rcv"] = _pair(r["received_en"], r["received_fr"])
            block(bid)["result"] = res
    for bid, b in blocks.items():
        b["objects"] = dict(sorted(objects[bid].items()))
    return blocks


def source_rows(conn: sqlite3.Connection, http_date_iso) -> list[dict]:
    """stats.json "sources": one row per file applied, plan, gaps, results. The file is the address's last
    part, with the start of its resource id where two parts share one name (the plan's two files of 2025-26)."""
    rows = conn.execute("SELECT part, url, resource_id, applied_at, last_modified FROM ipt_files ORDER BY part").fetchall()
    names = Counter(r["url"].rsplit("/", 1)[-1] for r in rows)
    out = []
    for r in rows:
        name = r["url"].rsplit("/", 1)[-1]
        if names[name] > 1:
            name = f"{name} ({(r['resource_id'] or r['part'])[:8]})"
        out.append({"source": STATS_SOURCE, "file": name, "last_read": r["applied_at"],
                    "last_modified": http_date_iso(r["last_modified"]), "last_modified_http": r["last_modified"], "loaded": True})
    return out
