"""Registry of Lobbyists, monthly communication reports: the lobbying stage.

Source: "Monthly Communication Reports", Office of the Commissioner of
Lobbying of Canada, open.canada.ca dataset
a34eb330-7136-4f5e-9f5f-3ba41df58b06, Open Government Licence - Canada. One
zip (config.LOBBYING_URL) holding a primary CSV, one row per communication
report, and secondary CSVs for the one-to-many parts (the designated public
office holders communicated with, the subject matters), all keyed by the
communication's id. The data dictionary is a separate spreadsheet on the same
host.

The layout here is unverified: the host refused this project's requests on
2026-10-31, the dictionary included. The columns are therefore found at run
time against a small map of the names the registry's exports use
(COMLOG_ID, COMM_DATE, EN_CLIENT_ORG_CORP_NM_AN, DPOH_LAST_NM_TCPD,
INSTITUTION, SUBJECT_CODE_OBJET ...) and looser patterns, file by file: a CSV
is read for whichever parts its header carries, whatever its name. A zip in
which no CSV carries a communication id with a date or a client is a changed
layout: the stage fails and the previous rows stay.

Downloads go through the polite client only, under its named user agent,
once a week (meta lobbying_loaded_at), as a conditional request, with the
cadence, checksum and refused-layout rules of contracts.refresh. A refusal
(any 4xx) is never answered with another request to the registry's host: the
stage reads a copy of the file kept elsewhere when it has one (below), or
else records the refusal as a notice, keeps the rows it has, and does not ask
again for REFUSAL_HOLD_DAYS. A 5xx or a timeout is a failed stage, tried
again on the next run.

The copies read while the host refuses (401 or 403), under the registry's
Open Data Licence Agreement: the seed, the operator's own download of the
zip, kept in R2 under seeds/ and fetched by the nightly workflow into
config.SEEDS_DIR; and the Internet Archive's newest capture of the file, found
with one query to the archive's index per weekly check and downloaded as its
original bytes. Only captures the archive already holds are read; nothing
asks the archive to fetch the registry. The copy whose primary file
(Communication_PrimaryExport.csv) was written later is read, the seed on a
tie or when the archive has no capture or does not answer, and never one
older than the copy the table holds (meta lobbying:file_date, written with
every load), so the table never goes back to older rows. A capture that
fails the zip's checks (check_zip) is passed over for the seed and not
downloaded again. The outcome is
"read (seed)", "unchanged (seed)", "read (archive <timestamp>)" or
"unchanged (archive)", with a notice naming the copy and the start of its
SHA-256. The host is still asked first every week, and the first week it
answers, its file replaces the copy's rows.

Loading rewrites lobbying_communications whole in one transaction. The client
goes through organizations.upsert; a client whose name reads as a person is
withheld (client_raw and organization_id NULL, client_withheld 1) and only
counted, its name listed for the operator in
data/out/review/lobbying-persons.txt. Each institution named goes through
buyers.resolve (source 'lobbying'), so buyer_ids lists the buyers a report
touches. Designated public office holders are named in their public role, as
the registry publishes them. A report replaced by a later version (the later
one names it as its previous report) is left out.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import sqlite3
import sys
import zipfile
import zlib
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .. import config, organizations
from ..db import get_meta, log_run, now_iso, set_meta
from ..http import FetchError, PoliteClient
from ..normalize import fold_accents, iso_date, squash
from . import buyers, matching
from .contracts import BATCH, LayoutError, StandIn, WeeklyFile, _shown, refresh

log = logging.getLogger(__name__)

# The sample a dev run reads stands under the file's own name.
SPEC = WeeklyFile("lobbying", config.LOBBYING_URL, "communications_ocl_cal.zip", "communications_ocl_cal.zip")
CHECK_EVERY_DAYS = SPEC.check_every_days
REFUSAL_HOLD_DAYS = 7
OTHER_INSTITUTION = {"other", "autre", "other / autre", "autre / other"}
# The member whose date says how recent a copy of the zip is (file_date).
PRIMARY_FILE = "communication_primaryexport.csv"
# The archive's index is a small answer: one that takes longer is passed over.
ARCHIVE_INDEX_TIMEOUT_S = 20
# Seconds between bytes of a capture (about 25 MB in November 2026).
ARCHIVE_TIMEOUT_S = 120
# A capture is downloaded beside the live file and deleted when the stage ends.
ARCHIVE_FILE = "archive-" + SPEC.file_name


# ---------------------------------------------------------------------------
# Columns, found at run time
# ---------------------------------------------------------------------------

def _norm_header(name: object) -> str:
    """'EN_CLIENT_ORG_CORP_NM_AN' -> 'enclientorgcorpnman'; a BOM, case, accents and punctuation do not count."""
    return re.sub(r"[^a-z0-9]", "", fold_accents(str(name or "").replace("﻿", "")).casefold())


# Each field: the exact header names known from the registry's exports, then
# a pattern over the normalized header for spellings not seen yet.
FIELDS: dict[str, tuple[tuple[str, ...], str | None]] = {
    "comm": (("comlogid", "communicationid", "communicationnumber", "commnumber", "commid", "comlognumber"),
             r"^(?!prev)(comlog|communication(report)?(id|num))"),
    "previous": (("prevcomlogidprecednt", "prevcomlogid", "previouscomlogid", "previouscommunicationid"),
                 r"^prev.*(comlog|comm)"),
    "registration": (("regnumenr", "registrationnumber", "registrationnum", "regnumber"), r"^reg(istration)?num"),
    "registrant_number": (("registrantnumdeclarant", "registrantnumber", "registrantnum"), r"^registrantnum"),
    "date": (("commdate", "communicationdate", "datecommunication", "comdate", "commdatedatecomm"),
             r"^comm?(unication)?date"),
    "registrant_last": (("rgstrntlastnmdclrnt", "registrantlastname", "registrantlastnm"),
                        r"(rgstrnt|registrant).*last"),
    "registrant_first": (("rgstrnt1stnmprenomdclrnt", "registrantfirstname", "registrantfirstnm"),
                         r"(rgstrnt|registrant).*(1st|first)"),
    "registrant": (("registrantname", "registrant", "lobbyistname"), None),
    "client_en": (("enclientorgcorpnman", "enclientorgcorpnm", "clientorgcorpnmen", "clientnameen", "clientname",
                   "client", "clientorganization"), r"^(en)?client.*(nm|name)(an|en)?$"),
    "client_fr": (("frclientorgcorpnm", "clientorgcorpnmfr", "clientnamefr"), r"^frclient.*(nm|name)"),
    "dpoh_last": (("dpohlastnmtcpd", "dpohlastname", "dpohlastnm"), r"dpoh.*last"),
    "dpoh_first": (("dpohfirstnmprenomtcpd", "dpohfirstname", "dpohfirstnm"), r"dpoh.*first"),
    "dpoh": (("dpohname", "dpoh"), None),
    "dpoh_title": (("dpohtitletitretcpd", "dpohtitle", "titletitretcpd"), r"(dpoh.*title|title.*tcpd)"),
    "institution": (("institution", "governmentinstitution", "dpohinstitution", "institutionname"),
                    r"^(?!other)(govt|government|dpoh)?institution"),
    "other_institution": (("otherinstitutionautre", "otherinstitution", "autreinstitution"), r"^other.*institution"),
    "subject": (("subjectcodeobjet", "subjectmatter", "subjectmatters", "subjectcode", "subject",
                 "subjectmattercode"), r"^subj"),
}
PRIMARY_FIELDS = ("date", "client_en", "client_fr", "registrant_last", "registrant", "registration",
                  "registrant_number", "previous")
DPOH_FIELDS = ("dpoh_last", "dpoh_first", "dpoh", "dpoh_title", "institution", "other_institution")


def find_columns(header: list[str]) -> dict[str, int]:
    """The position of each known field in a CSV header; a field the header lacks is absent."""
    normalized = [_norm_header(h) for h in header]
    found: dict[str, int] = {}
    taken: set[int] = set()
    # Exact names first for every field, so a loose pattern never takes a
    # column another field names exactly.
    for name, (exact, _) in FIELDS.items():
        for i, h in enumerate(normalized):
            if h in exact and i not in taken:
                found[name] = i
                taken.add(i)
                break
    for name, (_, pattern) in FIELDS.items():
        if name in found or pattern is None:
            continue
        for i, h in enumerate(normalized):
            if i not in taken and re.search(pattern, h):
                found[name] = i
                taken.add(i)
                break
    return found


def _encoding(head: bytes) -> str:
    """UTF-8 when the first block decodes as UTF-8 (a character cut at its end allowed), else Windows-1252."""
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as exc:
        if exc.start < len(head) - 3:
            return "cp1252"
    return "utf-8-sig"


@contextmanager
def _member_rows(zf: zipfile.ZipFile, member: zipfile.ZipInfo) -> Iterator[tuple[list[str], Iterator[list[str]]]]:
    with zf.open(member) as raw:
        head = raw.read(1 << 16)
    with io.TextIOWrapper(zf.open(member), encoding=_encoding(head), errors="replace", newline="") as text:
        reader = csv.reader(text)
        yield next(reader, []), reader


# ---------------------------------------------------------------------------
# Reading the zip
# ---------------------------------------------------------------------------

def _blank(value: str) -> str:
    text = squash(value)
    return "" if text.casefold() in ("null", "none", "n/a", "na") else text


@dataclass
class _Report:
    registration: str = ""
    registrant_number: str = ""
    date: str | None = None
    registrant: str = ""
    client_en: str = ""
    client_fr: str = ""
    previous: str = ""
    dpoh: list[tuple[str, str, str]] = field(default_factory=list)
    subjects: list[str] = field(default_factory=list)


@dataclass
class LobbyingStats:
    files: list[str] = field(default_factory=list)
    unread: list[str] = field(default_factory=list)
    reports: int = 0
    superseded: int = 0
    stored: int = 0
    withheld: int = 0
    redacted: int = 0          # withheld client names replaced in the subject matters
    dpoh_rows: int = 0
    orphans: int = 0           # office-holder or subject rows naming a report the primary file lacks
    missing: list[str] = field(default_factory=list)


def _open_zip(path: Path) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        # A page served in the file's place, or a copy cut short: refused like
        # a changed layout, so the previous rows stay and the copy is named.
        raise LayoutError(f"the lobbying file is not a zip ({exc}); the layout changed") from exc


def _csv_members(zf: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = [m for m in zf.infolist() if not m.is_dir() and m.filename.lower().endswith(".csv")]
    if not members:
        raise LayoutError("the lobbying zip holds no CSV; the layout changed")
    return members


def _kinds(cols: dict[str, int]) -> tuple[bool, bool]:
    """Whether a CSV with these columns carries reports, and whether it carries their parts."""
    is_primary = "comm" in cols and any(f in cols for f in PRIMARY_FIELDS)
    has_parts = "comm" in cols and (any(f in cols for f in DPOH_FIELDS) or "subject" in cols)
    return is_primary, has_parts


def _require_reports(primary: bool, seen: set[str]) -> None:
    if not primary or not seen & {"date", "client_en", "client_fr"}:
        raise LayoutError("no CSV in the lobbying zip carries a communication id with a date or a client; "
                          "the layout changed")


def check_zip(path: Path) -> None:
    """read_zip's checks without reading a row, and every member's checksum; raises LayoutError.

    For a copy fetched from elsewhere, so that one read_zip would refuse, or
    one damaged on the way, is passed over before it is chosen.
    """
    with _open_zip(path) as zf:
        members = _csv_members(zf)
        try:
            damaged = zf.testzip()
        except (zipfile.BadZipFile, zlib.error, EOFError) as exc:
            damaged = f"a member ({exc})"
        if damaged is not None:
            raise LayoutError(f"the lobbying zip is damaged: {damaged} does not read whole")
        seen: set[str] = set()
        primary = False
        for member in members:
            with _member_rows(zf, member) as (header, _rows):
                cols = find_columns(header)
            is_primary, has_parts = _kinds(cols)
            if is_primary or has_parts:
                seen.update(f for f in cols if f != "comm")
                primary = primary or is_primary
        _require_reports(primary, seen)


def file_date(path: Path) -> str | None:
    """When the zip's primary file was written, as its ZipInfo date (the registry's local time), ISO.

    The newest CSV's date when no member is named Communication_PrimaryExport.csv;
    None for a file that is no zip or holds no CSV.
    """
    try:
        with zipfile.ZipFile(path) as zf:
            members = [m for m in zf.infolist() if not m.is_dir() and m.filename.lower().endswith(".csv")]
            primary = [m for m in members if m.filename.rsplit("/", 1)[-1].lower() == PRIMARY_FILE] or members
            return max(datetime(*m.date_time).isoformat() for m in primary) if primary else None
    except (zipfile.BadZipFile, OSError, ValueError):
        return None


def read_zip(path: Path, stats: LobbyingStats) -> dict[str, _Report]:
    """Every communication report in the zip, with its office holders and subject matters."""
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    reports: dict[str, _Report] = {}
    secondary: list[tuple[dict[str, int], zipfile.ZipInfo]] = []
    shared: dict[str, str] = {}

    def keep(value: str) -> str:
        # Office holders, titles and institutions repeat on thousands of rows.
        return shared.setdefault(value, value)

    with _open_zip(path) as zf:
        members = _csv_members(zf)
        seen: set[str] = set()
        primary = False
        # The reports first, from whichever files carry them; their parts are
        # attached in a second pass, since the order of the zip is not known.
        for member in members:
            with _member_rows(zf, member) as (header, rows):
                cols = find_columns(header)
                is_primary, has_parts = _kinds(cols)
                if not (is_primary or has_parts):
                    stats.unread.append(member.filename)
                    continue
                stats.files.append(member.filename)
                seen.update(f for f in cols if f != "comm")
                if has_parts:
                    secondary.append((cols, member))
                if is_primary:
                    primary = True
                    for row in rows:
                        _primary_row(row, cols, reports)
        _require_reports(primary, seen)
        expected = {"date": ("date",), "client": ("client_en", "client_fr"),
                    "registrant": ("registrant_last", "registrant"), "office holder": ("dpoh_last", "dpoh"),
                    "institution": ("institution",), "subject matter": ("subject",)}
        stats.missing = [what for what, names in expected.items() if not seen & set(names)]
        for cols, member in secondary:
            with _member_rows(zf, member) as (_header, rows):
                for row in rows:
                    report = reports.get(_blank(_at(row, cols, "comm")))
                    if report is None:
                        stats.orphans += 1
                        continue
                    _secondary_row(row, cols, report, keep, stats)
    stats.reports = len(reports)
    return reports


def _at(row: list[str], cols: dict[str, int], name: str) -> str:
    i = cols.get(name)
    return row[i] if i is not None and i < len(row) else ""


def _primary_row(row: list[str], cols: dict[str, int], reports: dict[str, _Report]) -> None:
    comm = _blank(_at(row, cols, "comm"))
    if not comm:
        return
    report = reports.setdefault(comm, _Report())
    report.registration = _blank(_at(row, cols, "registration")) or report.registration
    report.registrant_number = _blank(_at(row, cols, "registrant_number")) or report.registrant_number
    report.date = iso_date(_blank(_at(row, cols, "date"))) or report.date
    whole = _blank(_at(row, cols, "registrant"))
    parts = squash(f"{_blank(_at(row, cols, 'registrant_first'))} {_blank(_at(row, cols, 'registrant_last'))}")
    report.registrant = whole or parts or report.registrant
    report.client_en = _blank(_at(row, cols, "client_en")) or report.client_en
    report.client_fr = _blank(_at(row, cols, "client_fr")) or report.client_fr
    report.previous = _blank(_at(row, cols, "previous")) or report.previous


def _secondary_row(row: list[str], cols: dict[str, int], report: _Report, keep: Callable[[str], str],
                   stats: LobbyingStats) -> None:
    if any(f in cols for f in DPOH_FIELDS):
        name = _blank(_at(row, cols, "dpoh")) or squash(
            f"{_blank(_at(row, cols, 'dpoh_first'))} {_blank(_at(row, cols, 'dpoh_last'))}")
        institution = _blank(_at(row, cols, "institution"))
        if not institution or institution.casefold() in OTHER_INSTITUTION:
            institution = _blank(_at(row, cols, "other_institution")) or institution
        title = _blank(_at(row, cols, "dpoh_title"))
        if name or institution:
            stats.dpoh_rows += 1
            entry = (keep(name), keep(title), keep(institution))
            if entry not in report.dpoh:
                report.dpoh.append(entry)
    if "subject" in cols:
        subject = _blank(_at(row, cols, "subject"))
        if subject and subject not in report.subjects:
            report.subjects.append(keep(subject))


# ---------------------------------------------------------------------------
# Writing the table
# ---------------------------------------------------------------------------

COLUMNS = (
    "comm_number", "registration_number", "registrant_number", "comm_date", "registrant_raw", "client_raw",
    "client_withheld", "organization_id", "subject_matters", "institutions", "buyer_ids", "dpoh", "loaded_at",
)


def _json(items: list) -> str | None:
    return json.dumps(items, ensure_ascii=False) if items else None


def load_zip(conn: sqlite3.Connection, path: Path, *, now: str | None = None,
             drops: matching.PersonDrops | None = None) -> LobbyingStats:
    """Rewrite lobbying_communications from one copy of the zip, in one transaction.

    The copy's file_date goes in with the rows (meta lobbying:file_date), so a
    stand-in older than the rows is never read (_Copies).
    """
    stamp = now or now_iso()
    stats = LobbyingStats()
    person_drops = drops if drops is not None else matching.PersonDrops()
    reports = read_zip(path, stats)
    replaced = {r.previous for r in reports.values() if r.previous}
    buyer_cache: dict[str, str | None] = {}

    def buyer(name: str) -> str | None:
        if name not in buyer_cache:
            buyer_cache[name] = buyers.resolve(conn, matching.first_language(name), source="lobbying", now=stamp)
        return buyer_cache[name]

    def rows() -> Iterator[tuple]:
        for comm in sorted(reports):
            if comm in replaced:
                stats.superseded += 1
                continue
            report = reports[comm]
            client = matching.first_language(report.client_en or report.client_fr)
            if matching.is_placeholder(client):
                client = ""
            withheld = bool(client) and matching.is_person_name(client)
            subjects = report.subjects
            if withheld:
                stats.withheld += 1
                person_drops.add(client)
                client_raw, org = None, None
                # The subject matters are the report's only free text; the
                # language of each is the filer's, so the English mark is used.
                persons = [n for n in (report.client_en, report.client_fr) if n]
                redacted = [matching.redact(s, persons) for s in subjects]
                subjects = [s for s, _ in redacted]
                stats.redacted += sum(n for _, n in redacted)
            else:
                client_raw = client or None
                org = organizations.upsert(conn, client, source="lobbying", now=stamp) if client else None
            institutions = list(dict.fromkeys(inst for _, _, inst in report.dpoh if inst))
            buyer_ids = list(dict.fromkeys(b for b in (buyer(inst) for inst in institutions) if b))
            dpoh = [{"name": name or None, "title": title or None, "institution": inst or None}
                    for name, title, inst in report.dpoh]
            yield (comm, report.registration or None, report.registrant_number or None, report.date,
                   report.registrant or None, client_raw, 1 if withheld else 0, org, _json(subjects),
                   _json(institutions), _json(buyer_ids), _json(dpoh), stamp)

    marks = ", ".join("?" * len(COLUMNS))
    sql = f"INSERT OR REPLACE INTO lobbying_communications ({', '.join(COLUMNS)}) VALUES ({marks})"
    try:
        conn.execute("DELETE FROM lobbying_communications")
        batch: list[tuple] = []
        for row in rows():
            batch.append(row)
            if len(batch) >= BATCH:
                conn.executemany(sql, batch)
                batch.clear()
        conn.executemany(sql, batch)
        stats.stored = conn.execute("SELECT COUNT(*) FROM lobbying_communications").fetchone()[0]
        if not stats.stored:
            raise LayoutError("the lobbying zip held no communication reports; the previous rows are kept")
        written = file_date(path)
        if written:
            set_meta(conn, SPEC.key("file_date"), written)
        else:
            conn.execute("DELETE FROM meta WHERE key = ?", (SPEC.key("file_date"),))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    log.info("lobbying: %d reports, %d stored, %d superseded, %d clients withheld", stats.reports, stats.stored,
             stats.superseded, stats.withheld)
    return stats


# ---------------------------------------------------------------------------
# The stage
# ---------------------------------------------------------------------------

def _iso(text: str) -> datetime:
    when = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def refusal_notice(status: int, until: str) -> str:
    if status in (404, 410):
        what = f"the registry answered {status} (the file's address may have changed)"
    else:
        what = f"the registry refused the download ({status})"
    return f"lobbying: {what}; not retried until {until}"


@dataclass(frozen=True)
class Capture:
    """One capture in the Internet Archive's index: when it was taken (UTC, 14 digits) and the archive's digest."""

    timestamp: str
    digest: str

    @property
    def key(self) -> str:
        return f"{self.timestamp} {self.digest}"

    @property
    def url(self) -> str:
        return config.LOBBYING_ARCHIVE_CAPTURE.format(timestamp=self.timestamp)


def newest_capture(client: PoliteClient) -> Capture | None:
    """The newest capture of the registry's file the archive holds, from one query to its index.

    None when it holds none, or when the index does not answer or answers
    something else: the seed then stands alone.
    """
    try:
        rows = json.loads(client.get(config.LOBBYING_ARCHIVE_INDEX, timeout=ARCHIVE_INDEX_TIMEOUT_S))
        if not rows:
            return None  # the archive holds no capture of the file
        header = rows[0]
        at, digest = header.index("timestamp"), header.index("digest")
        found = [Capture(str(row[at]), str(row[digest])) for row in rows[1:]
                 if re.fullmatch(r"\d{14}", str(row[at])) and row[digest]]
    except (FetchError, ValueError, TypeError, IndexError, KeyError, AttributeError) as exc:
        log.warning("lobbying: the Internet Archive's index gave no capture (%s)", exc)
        return None
    # The newest of what came back, whatever order the index used.
    return max(found, key=lambda c: c.timestamp, default=None)


class _Copies:
    """The stand-in for a refused download (contracts.refresh): the seed or the archive's newest capture.

    Called once per weekly check, only after the registry's host refused.
    Notices go straight to the stage's list.
    """

    def __init__(self, conn: sqlite3.Connection, client: PoliteClient, seed: Path, capture_path: Path,
                 notices: list[str]) -> None:
        self.conn = conn
        self.client = client
        self.seed = seed
        self.capture_path = capture_path
        self.notices = notices
        self.capture: Capture | None = None
        self.chosen: StandIn | None = None

    def __call__(self) -> StandIn | None:
        held = get_meta(self.conn, SPEC.key("file_date"))
        seed = self.seed if self.seed.is_file() else None
        best = StandIn(seed) if seed is not None else None
        best_date = file_date(seed) if seed is not None else None
        found = self._capture(max((d for d in (best_date, held) if d), default=None))
        # The seed wins a tie; a seed with no date is no zip, and loses.
        if found is not None and (best is None or best_date is None or (found[1] or "") > best_date):
            best, best_date = found
        if best is not None and held and best_date and best_date < held:
            # The table's rows are newer than any copy at hand: the refusal stands.
            best = None
        self.chosen = best
        return best

    def _capture(self, newest: str | None) -> tuple[StandIn, str | None] | None:
        """The archive's newest capture with its file_date, when it may be newer than newest; None otherwise."""
        capture = newest_capture(self.client)
        if capture is None:
            return None
        self.capture = capture
        label = f"archive {capture.timestamp}"
        table = get_meta(self.conn, SPEC.key("sha256"))
        if (capture.key == get_meta(self.conn, SPEC.key("archive_capture")) and table
                and table == get_meta(self.conn, SPEC.key("archive_sha256"))):
            # The table holds this capture's rows already: nothing to fetch again.
            return StandIn(None, "archive", label), get_meta(self.conn, SPEC.key("file_date"))
        if capture.key == get_meta(self.conn, SPEC.key("archive_refused")):
            return None
        if newest and capture.timestamp[:8] < newest[:10].replace("-", ""):
            # Taken the day before that copy was written, or earlier: it holds an
            # older file, so it is not downloaded. (The registry's local date is
            # never ahead of the archive's UTC one.)
            return None
        try:
            self.client.download(capture.url, self.capture_path, timeout=ARCHIVE_TIMEOUT_S)
        except FetchError as exc:
            log.warning("lobbying: the Internet Archive's capture %s did not download (%s)", capture.timestamp, exc)
            return None
        try:
            check_zip(self.capture_path)
        except LayoutError as exc:
            # Remembered, so the same capture is not downloaded again next week.
            set_meta(self.conn, SPEC.key("archive_refused"), capture.key)
            self.conn.commit()
            self.notices.append(f"lobbying: the Internet Archive's capture {capture.timestamp} was not read: {exc}")
            return None
        return StandIn(self.capture_path, "archive", label), file_date(self.capture_path)

    def notice(self, digest: str, *, read: bool) -> str:
        assert self.chosen is not None
        if self.chosen.source == "archive" and self.capture is not None:
            copy = f"the Internet Archive's capture {self.capture.timestamp} (sha256 {digest[:12]})"
        else:
            copy = f"the seed copy {_shown(self.seed)} (sha256 {digest[:12]})"
        return f"lobbying: read from {copy}" if read else f"lobbying: {copy} is unchanged; its rows stay"


@dataclass
class LobbyingResult:
    # read | unchanged | read (seed) | unchanged (seed) | read (archive <timestamp>) | unchanged (archive)
    # | not due | no sample | refused: ... | held: ...
    state: str = ""
    stats: LobbyingStats | None = None
    notices: list[str] = field(default_factory=list)

    def detail(self) -> str:
        s = self.stats
        if s is None:
            return self.state
        return (f"{self.state} files={','.join(s.files)} reports={s.reports} stored={s.stored} "
                f"superseded={s.superseded} withheld={s.withheld} office_holder_rows={s.dpoh_rows} "
                f"redacted={s.redacted}")


def _held(conn: sqlite3.Connection, stamp: str) -> str | None:
    """The notice for a refusal still being honoured; None when the stage may ask again."""
    until = get_meta(conn, SPEC.key("refused_until"))
    if until and stamp[:10] < until:
        return refusal_notice(int(get_meta(conn, SPEC.key("refused_status")) or 403), until)
    return None


def _log(conn: sqlite3.Connection, result: LobbyingResult) -> LobbyingResult:
    s = result.stats
    log_run(conn, "lobbying", detail=result.detail(), rows_in=s.reports if s else 0, rows_new=s.stored if s else 0,
            excluded=s.withheld if s else 0, notice=" | ".join(result.notices) or None)
    return result


def run(conn: sqlite3.Connection, client: PoliteClient | None, *, now: str | None = None,
        samples: Path | None = None, work_dir: Path | None = None, review_dir: Path | None = None) -> LobbyingResult:
    """The lobbying stage: fetch the zip weekly unless a refusal is being honoured, rewrite the table, log one row.

    While the host refuses, the seed or the archive's capture is read instead (_Copies).
    """
    stamp = now or now_iso()
    result = LobbyingResult()
    buyers.take_notices(conn)
    buyers.take_rejects(conn)
    conn.commit()
    held = _held(conn, stamp) if samples is None else None
    if held:
        result.state = f"held: refused on {get_meta(conn, SPEC.key('refused_on'))}"
        result.notices.append(held)
        return _log(conn, result)
    drops = matching.PersonDrops()
    copies = None
    if samples is None and client is not None:
        copies = _Copies(conn, client, config.SEEDS_DIR / SPEC.file_name,
                         (work_dir or config.WORK_DIR) / ARCHIVE_FILE, result.notices)
    try:
        result.state, result.stats = refresh(
            conn, client, SPEC, lambda path: load_zip(conn, path, now=stamp, drops=drops),
            stamp=stamp, samples=samples, work_dir=work_dir, stand_in=copies,
        )
    except FetchError as exc:
        if exc.status is None or not 400 <= exc.status < 500:
            raise  # a 5xx or a timeout: a failed stage, tried again on the next run
        # A refusal is the host's decision: recorded, and honoured until the hold ends.
        until = (_iso(stamp) + timedelta(days=REFUSAL_HOLD_DAYS)).date().isoformat()
        set_meta(conn, SPEC.key("refused_on"), stamp[:10])
        set_meta(conn, SPEC.key("refused_status"), exc.status)
        set_meta(conn, SPEC.key("refused_until"), until)
        conn.commit()
        result.state = f"refused: HTTP {exc.status}"
        result.notices.append(refusal_notice(exc.status, until))
        return _log(conn, result)
    finally:
        if copies is not None:
            copies.capture_path.unlink(missing_ok=True)
    if copies is not None and copies.chosen is not None:
        # A copy stood in for the refusal: the notice names it. The table's
        # checksum is the copy's, read or unchanged.
        if copies.chosen.source == "archive" and copies.capture is not None:
            set_meta(conn, SPEC.key("archive_capture"), copies.capture.key)
        result.notices.append(copies.notice(get_meta(conn, SPEC.key("sha256")) or "",
                                            read=result.state.startswith("read")))
    if samples is None:
        conn.execute("DELETE FROM meta WHERE key IN (?, ?, ?)",
                     (SPEC.key("refused_on"), SPEC.key("refused_status"), SPEC.key("refused_until")))
        conn.commit()
    elif result.state == "no sample":
        result.notices.append(f"lobbying: no {SPEC.sample_name} in the samples folder; not downloaded (samples run)")
    stats = result.stats
    if stats is not None:
        rejected = buyers.take_rejects(conn)
        review = drops.write((review_dir or config.OUT_DIR / "review") / "lobbying-persons.txt",
                             what="Lobbying communication reports", stamp=stamp, withheld="client withheld",
                             buyers=rejected)
        if review:
            result.notices.append(review)
        if stats.missing:
            result.notices.append(f"the lobbying zip carries no {', '.join(stats.missing)} column")
        if stats.unread:
            result.notices.append(f"lobbying zip, files not read (no communication id or known column): "
                                  f"{', '.join(stats.unread)}")
        if stats.orphans:
            result.notices.append(f"{stats.orphans} office-holder or subject rows name a report the primary file lacks")
    made = buyers.take_notices(conn)
    if made:
        shown = "; ".join(made[:15]) + (f" (+{len(made) - 15} more)" if len(made) > 15 else "")
        result.notices.append(f"{len(made)} institutions not in CKAN or the seed: {shown}")
    return _log(conn, result)
