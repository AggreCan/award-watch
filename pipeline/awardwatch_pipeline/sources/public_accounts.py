"""The Public Accounts of Canada, professional and special services: the public_accounts stage.

Source: PSPC's "Detailed information on Professional and Special Services, as per the Public Accounts of
Canada", open.canada.ca dataset ac597ff8-ee13-48c3-b315-42e528090af2 (config.PA_SERVICES_DATASET), Open
Government Licence - Canada. One CSV a fiscal year, published each autumn for the year that ended on March
31: the file named 2026 holds fiscal 2025-26. The record says of itself that it is not the official record;
the official version is the Public Accounts of Canada on the Receiver General's site.

These are payments in a fiscal year. Every other source the site holds is a contract or agreement value, and
nothing here is ever added to one: the tables below feed two blocks of their own in the static export (a
profile's "public_accounts", a buyer file's "public_accounts") and nothing else (docs/public-accounts.md).

A file of the 2026 layout (LAYOUT_2026: the payee, its city, province and country in columns of their own,
each in English and French) is read in blocks, one per department and class of service:

* a header row with no payee, whose current-year column holds the class total as published;
* named rows, one per payee paid $100,000 or more in the class, the amount in the aggregate column;
* "Service payment(s) under $100,000 (N)" rows: the payees paid less, a count and a total;
* "Name withheld" rows, the publisher's own withholding.

Each block's rows add up to its header; a file with more than BLOCKS_OFF_SHARE of its blocks off is held.

The rules for a named row, in order (docs/public-accounts.md "The rules"):

1. Persons (person_rule), before anything is written: the publisher's "Name withheld"; the site's test
   (matching.is_person_name) on the legal part (matching.filed_name); then three rules of this stage only, so
   no other source moves: a courtesy title "(Dr)", "(MD)" or a leading "Dr"; a professional corporation whose
   name without its form reads as a person; one or two capitalized words followed by one or two capitals
   that are not a legal form ("<Surname> <II>"). Also a name whose hash is in config.PA_WITHHOLD. A withheld
   row keeps its department, class and amount, so the class totals stay as published; every name and place
   column is NULL.
2. Federal payees (FederalIndex): the name, without its brackets, inverted ("Health (Department of)") and
   without a place written after it, each keyed by buyers.name_key, equal to the key of a department name of
   these files or of a buyer title (buyer_names sources ckan, seed and alias). No shortening and no acronym
   rule. Such a row names a buyer and no organization.
3. The place a 2026 payee still carries in its name (", Ottawa, Ontario") is cut (strip_place) before its
   name is normalized: a trailing comma part that is a province or state, the row's own city or country, or a
   city the file's city column holds.
4. The link: the id organizations.upsert would give the legal part, sent on through organization_aliases,
   kept only when that organization exists. Never created. A name of one word or of generic words only
   (matching.is_common_name) links only when the payee's province is among the organization's. A link whose
   province (or country abroad) is not among the organization's addresses keeps the link and carries pf = 1.
   A match key (match_key.match_key) naming an organization is listed for review and never linked.
5. Every night the links are computed again from the stored names (relink), so a merge moves the payments.

Cadence: the dataset record (package_show, one request) is read every night from September to January, when
every release so far has landed, and weekly otherwise. The newest year's file is downloaded only when the
record lists a newer year, a changed address or a changed last_modified, or when the rules here changed
(rules()); the request is conditional on the copy last applied, and a copy with the same SHA-256 is not read
again. Most nights make one request and read nothing.

A download that fails, a record that does not read, a layout that is not known, a file whose named rows fall
by more than HOLD_FALL from the copy of the same year applied before, or too many class blocks that do not
add up: the previous rows stand, the stage logs a notice and ends ok, so a yearly source never sets off the
retries a failed stage does. A held copy is not downloaded again until the record changes or the operator
writes the copy's SHA-256 (12 characters or more) to config.PA_RELEASE. Only an exception in this module's
own code fails the stage.
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import re
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Collection, Iterable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlsplit

from .. import config, organizations
from ..db import get_meta, hours_since, log_run, now_iso, set_meta
from ..http import AbortRun, FetchError, PoliteClient
from ..match_key import ABBREVIATIONS, match_key
from ..normalize import (
    LEGAL_SUFFIXES, NORMALIZE_VERSION, PROVINCE_CODES, PROVINCES, country_code, fold_accents, norm_name, org_id,
    province_code, squash,
)
from . import buyers, matching
from .contracts import LayoutError, LoadStats, csv_rows, sha256

log = logging.getLogger(__name__)

SOURCE = "public_accounts"
FAMILY = "services"
# The row of stats.json "sources" the Data page lists the files under.
STATS_SOURCE = "pa_services"
STATS_DEFAULT_FILE = "idsps-dipss"
SAMPLE_NAME = "pa-services.csv"
REVIEW_FILE = "public-accounts.txt"
PERSONS_FILE = "public-accounts-persons.txt"

# Raised whenever this module reads a row differently (the person rules, the strip, the row kinds): with the
# name rules, the shared person test and the hand-kept hashes it makes rules(), and a file applied under other
# rules is read again on the next night.
RULES_VERSION = 1

# What the export shows (site/src/public_accounts.tsx holds the same figures): the newest fiscal years a
# profile and a buyer file carry, a profile's rows a year, a buyer file's payees.
PA_FREE_YEARS = 3
PA_PROFILE_ROWS = 100
PA_BUYER_PAYEES = 50

HOLD_FALL = 0.30
BLOCKS_OFF_SHARE = 0.02
# A block's rows are rounded to the dollar and its header is not: $10, plus a dollar a row.
BLOCK_SLACK_CENTS = 1000
# The dataset record: nightly in the release season (September to January), else weekly. 20 hours, so a run
# that starts a little earlier than the night before still asks.
SEASON_MONTHS = (9, 10, 11, 12, 1)
CHECK_HOURS_SEASON = 20
CHECK_HOURS_OTHER = 7 * 24 - 4
TIMEOUT_S = 300
REVIEW_LIST_MAX = 300
KEY_CANDIDATES_PER_WORD = 5000

META_CHECKED = "public_accounts:ckan_read_at"
# The copy last refused or held: {"why", "fy", "url", "ckan_modified", "sha256", "etag", "last_modified", "rules"}.
META_HOLD = "public_accounts:hold"
# The review's two costly lists, worked out when a file is applied and kept until the next: the match key
# candidates ({spelling: [organization ids]}) and the general resolver's federal readings ([[spelling, buyer]]).
META_REVIEW = "public_accounts:review"

HEADER, NAMED, UNDER, WITHHELD, FEDERAL = "header", "named", "under", "withheld", "federal"

# The 2026 layout's columns (the data dictionary's names); a file without one of them is refused.
FY_COL = "Fscl-yr_Ex-fin"
DEPT_NO, DEPT_EN, DEPT_FR = "Dept-nbr_No-min", "Dept-name_Nom-min_eng", "Dept-name_Nom-min_fra"
CLS, CLS_EN, CLS_FR = "Rpt-obj_Art-rppt", "Rpt-obj_Art-rppt_eng", "Rpt-obj_Art-rppt_fra"
PAYEE_EN, PAYEE_FR = "Contractor-details_Details-entrepr_eng", "Contractor-details_Details-entrepr_fra"
CITY_EN, CITY_FR = "Contractor-city_Ville-entrepr_eng", "Contractor-city_Ville-entrepr_fra"
PROV_EN, PROV_FR = "Contractor-province_Province-entrepr_eng", "Contractor-province_Province-entrepr_fra"
COUNTRY_EN, COUNTRY_FR = "Contractor-country_Pays-entrepr_eng", "Contractor-country_Pays-entrepr_fra"
CURRENT, AGGREGATE = "Xpnd-current-yr_Dep-ex-courant", "Aggregate-payments_Versements-totalisant"
LAYOUT_2026 = "split2026"
REQUIRED_2026 = (
    FY_COL, "Min-code", "Min-portfolio_Portefeuille-min_eng", "Min-portfolio_Portefeuille-min_fra", DEPT_NO, DEPT_EN,
    DEPT_FR, CLS, CLS_EN, CLS_FR, PAYEE_EN, PAYEE_FR, CITY_EN, CITY_FR, PROV_EN, PROV_FR, COUNTRY_EN, COUNTRY_FR,
    CURRENT, AGGREGATE,
)

# A yearly file as the dataset record lists it: idsps-dipss-2026.csv (bilingual), or -2021-eng.csv and -fra.csv.
FILE_RE = re.compile(r"/idsps-dipss-(\d{4})(?:-(eng|fra))?\.csv$", re.I)
FY_RE = re.compile(r"^\s*(\d{4})\s*[/-]\s*(\d{4})(?:\s*-\s*COMP)?\s*$", re.I)
# "Service payments under $100,000 (396)", "(28 payees)", "(1 payee)", and two written with no count.
UNDER_RE = re.compile(r"^\s*service\s+payments?\s+under\s+\$?\s*100,?000\s*(?:\((\d[\d,]*)(?:\s+payees?)?\))?\s*$", re.I)
NAME_WITHHELD_RE = re.compile(r"^\s*(?:name\s+withheld|nom\s+retenu)\s*(?:\(\d+\))?\s*$", re.I)

# Rule 3: a courtesy title in brackets anywhere, or before the name.
TITLE_RE = re.compile(r"\((?:dr|md)\.?\)|^\s*dr\.?\s", re.I)
# Rule 4: the forms a practitioner's corporation is written with, at the end of the name, a "(Dr)" or "(MD)"
# around them; what is left is read by the person test.
_PRACTICE = r"(?:medicine|medical|dentistry|dental|law|legal|psychology|psychological|chiropractic|optometry|physiotherapy|nursing|pharmacy)"
PRACTICE_FORM_RE = re.compile(
    r"(?:[\s,]+|^)(?:\((?:dr|md)\.?\)\s*)?"
    r"(?:(?:" + _PRACTICE + r"\s+)?(?:professional\s+corp(?:oration)?|prof\.?\s*corp(?:oration)?)\.?(?:\s+inc\.?)?"
    r"|(?:dental|medical|dentistry|medicine)\s+corp(?:oration)?\.?(?:\s+inc\.?)?"
    r"|notary(?:\s+public)?(?:\s+(?:inc|corp(?:oration)?)\.?)?"
    r"|(?:notaires?|avocats?)\s+inc\.?"
    r"|p\.?\s?c\.?)"
    r"\s*(?:\((?:dr|md)\.?\)\s*)?$",
    re.I,
)
COURTESY_START_RE = re.compile(r"^\s*(?:dr|dre|mr|mrs|ms|mme|me)\.?\s", re.I)
# Rule 5: "<Surname> <II>", "<Given> <Surname> <I>". Two capitals at most: on the 2026 file every name ending
# in three is a firm's (a law firm's letters, a charity's acronym, a company form abroad).
CAPS_TAIL_RE = re.compile(r"^([^\W\d_][^\W\d_'’-]+)(?:\s+([^\W\d_][^\W\d_'’-]+))?\s+([A-Z]{1,2})$")
CAPS_LEGAL = frozenset(matching.FOREIGN_LEGAL_FORMS | LEGAL_SUFFIXES | {"na", "llc", "plc", "inc", "co"})

# The trailing comma parts strip_place cuts beside the file's own cities and provinces: the provinces and
# territories by name and code, and the United States by its postal codes.
US_CODES = frozenset((
    "al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok "
    "or pa ri sc sd tn tx ut vt va wa wv wi wy"
).split())


def fold(text: object) -> str:
    """How two places are compared: accents folded, case dropped, punctuation made spaces."""
    return " ".join(re.sub(r"[^\w]+", " ", fold_accents(squash(text)).casefold()).split())


def fiscal_year(text: object) -> int | None:
    """'2025/2026' or '2025-2026' (a restated '-COMP' row too) -> 2025; None when it is not one year to the next."""
    m = FY_RE.match(str(text or ""))
    if not m or int(m.group(2)) != int(m.group(1)) + 1:
        return None
    return int(m.group(1))


def cents(text: object) -> int | None:
    """'13911994' -> 1391199400, '-23,595' -> -2359500, '(100)' -> -10000; None for a blank or text."""
    raw = re.sub(r"[\s$, ]", "", str(text or ""))
    if not raw:
        return None
    negative = raw.startswith("(") and raw.endswith(")")
    try:
        value = Decimal(raw[1:-1] if negative else raw)
    except InvalidOperation:
        return None
    if not value.is_finite():
        return None
    out = int((value * 100).to_integral_value())
    return -out if negative else out


def dollars(value: int | None) -> int | float | None:
    """Cents as the export writes them: whole dollars, the cents only when there are any."""
    if value is None:
        return None
    return value // 100 if value % 100 == 0 else value / 100


def under_count(name: str) -> tuple[bool, int | None]:
    """(an under-threshold row, the payees it counts or None when it gives none)."""
    m = UNDER_RE.match(name)
    if not m:
        return False, None
    return True, int(m.group(1).replace(",", "")) if m.group(1) else None


# ---------------------------------------------------------------------------
# Names: the place strip and the person rules
# ---------------------------------------------------------------------------

@dataclass
class Places:
    """The places a file's rows write: every city and every province or state, folded."""
    cities: set[str] = field(default_factory=set)
    regions: set[str] = field(default_factory=lambda: {fold(n) for n in PROVINCES} | {c.casefold() for c in PROVINCE_CODES}
                              | set(US_CODES))

    def add(self, city_en: object, city_fr: object, prov_en: object, prov_fr: object) -> None:
        for city in (city_en, city_fr):
            if fold(city):
                self.cities.add(fold(city))
        for prov in (prov_en, prov_fr):
            if fold(prov):
                self.regions.add(fold(prov))


def strip_place(name: str, places: Places, *own: object) -> str:
    """The name without the place written after it: "Deloitte LLP, Ottawa, Ontario" -> "Deloitte LLP".

    Trailing comma parts are cut while each is a province or state, one of own (the row's city and country),
    or a city of the file; the first part always stays. A name with no comma is never cut ("Innovate BC").
    """
    parts = [p.strip() for p in name.split(",")]
    mine = {fold(x) for x in own if fold(x)}
    while len(parts) > 1:
        last = fold(parts[-1])
        if last and (last in places.regions or last in mine or last in places.cities):
            parts.pop()
            continue
        break
    return ", ".join(parts)


def legal_part(name: str) -> str:
    """The part of a payee's name it is filed under: a person's name before a bracketed firm is left out."""
    return matching.filed_name(matching.first_language(name))[0] or ""


def withhold_key(norm: str) -> str:
    """A name's line in config.PA_WITHHOLD: a hash of its normalized form, which holds no name."""
    return hashlib.blake2b(norm.encode("utf-8"), digest_size=16, person=b"pa-withhold").hexdigest()


def read_withheld(path: Path | None = None) -> frozenset[str]:
    """The hashes in config.PA_WITHHOLD, one per line; # starts a comment."""
    try:
        text = (path or config.PA_WITHHOLD).read_text(encoding="utf-8")
    except OSError:
        return frozenset()
    return frozenset(line.split("#", 1)[0].strip().lower() for line in text.splitlines() if line.split("#", 1)[0].strip())


def rules() -> str:
    """The rules a file is read under: this module's version, the name rules, the person test and a digest of
    the hand-kept hashes, so a line added to config.PA_WITHHOLD reads the files again."""
    seeded = hashlib.blake2b(" ".join(sorted(read_withheld())).encode("ascii"), digest_size=4).hexdigest()
    return f"{RULES_VERSION}.{NORMALIZE_VERSION}.{matching.person_test_stamp()}.{seeded}"


def _practice_head(name: str) -> str | None:
    """A practitioner's corporation without its form ("<name> Dental Corporation" -> "<name>"), or None."""
    m = PRACTICE_FORM_RE.search(name)
    if not m or m.start() == 0:
        return None
    head = re.sub(r"\((?:dr|md)\.?\)", " ", name[:m.start()], flags=re.I)
    return squash(head).strip(" ,;:-") or None


def _caps_tail(name: str) -> bool:
    m = CAPS_TAIL_RE.match(name.strip())
    # A legal form ("Nordwave AB"), or a province or a state ("Innovate BC"), is no one's initials.
    if not m or m.group(3).casefold() in CAPS_LEGAL | US_CODES or m.group(3) in PROVINCE_CODES:
        return False
    words = [w for w in (m.group(1), m.group(2)) if w]
    # Each word a capitalized name ("Vexlor"), never an acronym ("IBM CA") or a business word.
    return all(w[0].isupper() and any(c.islower() for c in w[1:]) for w in words) and not any(
        matching._key(w) in matching.PUBLIC_BUSINESS_WORDS or matching._key(w) in matching.GENERIC_WORDS for w in words)


def person_rule(en: str, fr: str, places: Places, own: tuple[object, ...], withheld: frozenset[str] = frozenset()) -> str | None:
    """The rule that withholds a payee as a person ("1" to "5", or "seed"), or None for a payee that is named.

    Every rule reads the English and the French name, each as written and without the place after it, so a
    spelling of either that reads as a person withholds the row.
    """
    if NAME_WITHHELD_RE.match(en) or NAME_WITHHELD_RE.match(fr):
        return "1"
    forms: list[str] = []
    english = 0
    for text in (en, fr):
        if text:
            legal = legal_part(text)
            for form in (legal, strip_place(legal, places, *own)):
                if form and form not in forms:
                    forms.append(form)
        if text is en:
            english = len(forms)
    if any(matching.is_person_name(f) for f in forms) or any(matching.is_person_name(t) for t in (en, fr) if t):
        return "2"
    if any(TITLE_RE.search(t) for t in (en, fr) if t):
        return "3"
    for f in forms:
        head = _practice_head(f)
        if head and (COURTESY_START_RE.match(head) or matching.is_person_name(head)):
            return "4"
    # The English name only: a French spelling translates the words before the capitals ("Travail
    # Sécuritaire NB").
    if any(_caps_tail(f) for f in forms[:english]):
        return "5"
    if withheld and any(withhold_key(norm_name(f)) in withheld for f in forms if norm_name(f)):
        return "seed"
    return None


# ---------------------------------------------------------------------------
# Reading a file
# ---------------------------------------------------------------------------

@dataclass
class Row:
    seq: int
    kind: str
    dept_no: str | None
    dept_en: str
    dept_fr: str | None
    cls: str
    cls_en: str | None
    cls_fr: str | None
    payee_en: str | None = None
    payee_fr: str | None = None
    city: str | None = None
    city_fr: str | None = None
    prov: str | None = None
    prov_fr: str | None = None
    country: str | None = None
    country_fr: str | None = None
    cents: int | None = None
    n_payees: int | None = None
    why: str | None = None


@dataclass
class Parsed:
    fy: int | None = None
    layout: str = LAYOUT_2026
    rows: list[Row] = field(default_factory=list)
    read: int = 0                     # data rows in the file
    skipped: int = 0                  # rows with no fiscal year, department or class, or cut short
    extra: list[str] = field(default_factory=list)
    blocks: int = 0
    blocks_off: list[tuple[str, str, int | None, int]] = field(default_factory=list)

    @property
    def named(self) -> int:
        """The rows naming a payee or withholding one: what the hold rule compares."""
        return sum(1 for r in self.rows if r.kind in (NAMED, WITHHELD))


def _text(value: object) -> str | None:
    return squash(value) or None


def read_file(path: Path, drops: matching.PersonDrops, *, partial_tail: bool = False,
              withheld: frozenset[str] | None = None) -> Parsed:
    """Every row of one file, persons already withheld (their names go to drops and nowhere else).

    Raises LayoutError, before a row is kept, for a file without a column of the 2026 layout, with no row of
    a fiscal year, or holding rows of two fiscal years."""
    parsed = Parsed()
    stats = LoadStats()
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as fh:
        head = next(csv.reader(fh), [])
    headers = [h.strip() for h in head]
    parsed.extra = [h for h in headers if h and h not in REQUIRED_2026]
    raw: list[tuple[int, dict[str, str]]] = []
    years: Counter = Counter()
    with csv_rows(path, REQUIRED_2026, (), path.name, stats, partial_tail=partial_tail) as getters:
        for get in getters:
            fy = fiscal_year(get(FY_COL))
            row = {c: get(c) for c in REQUIRED_2026}
            if fy is None or not squash(row[DEPT_EN]) or not squash(row[CLS]):
                parsed.skipped += 1
                continue
            years[fy] += 1
            raw.append((stats.rows, row))
    parsed.read = stats.rows
    parsed.skipped += stats.skipped
    if not years:
        raise LayoutError(f"{path.name} holds no row of a fiscal year; the previous rows are kept")
    if len(years) > 1:
        raise LayoutError(f"{path.name} holds rows of {len(years)} fiscal years ({', '.join(map(str, sorted(years)))})")
    parsed.fy = next(iter(years))
    places = Places()
    for _, r in raw:
        places.add(r[CITY_EN], r[CITY_FR], r[PROV_EN], r[PROV_FR])
    seeded = read_withheld() if withheld is None else withheld
    for seq, r in raw:
        base = dict(seq=seq, dept_no=_text(r[DEPT_NO]), dept_en=squash(r[DEPT_EN]), dept_fr=_text(r[DEPT_FR]),
                    cls=squash(r[CLS]), cls_en=_text(r[CLS_EN]), cls_fr=_text(r[CLS_FR]))
        en, fr = squash(r[PAYEE_EN]), squash(r[PAYEE_FR])
        if not en and not fr:
            parsed.rows.append(Row(kind=HEADER, cents=cents(r[CURRENT]), **base))
            continue
        under, n = under_count(en or fr)
        if under:
            parsed.rows.append(Row(kind=UNDER, cents=cents(r[AGGREGATE]), n_payees=n, **base))
            continue
        amount = cents(r[AGGREGATE])
        rule = person_rule(en, fr, places, (r[CITY_EN], r[CITY_FR], r[COUNTRY_EN], r[COUNTRY_FR]), seeded)
        if rule is not None:
            if rule != "1":
                drops.add(en or fr)
            # Nothing that names or places the person is kept: the department, the class and the amount stay.
            parsed.rows.append(Row(kind=WITHHELD, cents=amount, why=rule, **base))
            continue
        # A person's name before a bracketed firm leaves with it: the row is filed under the firm.
        shown_en = legal_part(en) if en else None
        shown_fr = legal_part(fr) if fr else None
        parsed.rows.append(Row(
            kind=NAMED, cents=amount, payee_en=shown_en or shown_fr, payee_fr=shown_fr if shown_fr != (shown_en or shown_fr) else None,
            city=_text(r[CITY_EN]), city_fr=_text(r[CITY_FR]) if squash(r[CITY_FR]) != squash(r[CITY_EN]) else None,
            prov=_text(r[PROV_EN]), prov_fr=_text(r[PROV_FR]), country=_text(r[COUNTRY_EN]), country_fr=_text(r[COUNTRY_FR]),
            **base))
    parsed.blocks, parsed.blocks_off = check_blocks((r.dept_no, r.dept_en, r.cls, r.kind, r.cents) for r in parsed.rows)
    return parsed


def check_blocks(rows: Iterable[tuple[str | None, str, str, str, int | None]]) -> tuple[int, list[tuple[str, str, int | None, int]]]:
    """(blocks, the blocks whose rows do not add up to their header): each (department, class, header, sum)."""
    head: dict[tuple, int | None] = {}
    total: dict[tuple, int] = defaultdict(int)
    count: Counter = Counter()
    for dept_no, dept, cls, kind, amount in rows:
        key = (dept_no or "", dept, cls)
        if kind == HEADER:
            head[key] = (head.get(key) or 0) + (amount or 0) if amount is not None else head.get(key)
        else:
            total[key] += amount or 0
            count[key] += 1
    off = []
    for key in sorted(set(head) | set(total)):
        h = head.get(key)
        s = total.get(key, 0)
        if h is None or abs(h - s) > BLOCK_SLACK_CENTS + 100 * count[key]:
            off.append((key[1], key[2], h, s))
    return len(set(head) | set(total)), off


# ---------------------------------------------------------------------------
# Writing a file's rows
# ---------------------------------------------------------------------------

COLUMNS = ("fy", "seq", "kind", "dept_no", "dept_en", "dept_fr", "cls", "cls_en", "cls_fr", "payee_raw", "payee_fr",
           "city", "city_fr", "prov", "prov_fr", "country", "country_fr", "prov_code", "cents", "n_payees", "why")


def _prov_code(prov: str | None, country: str | None) -> str | None:
    """Two letters for a province or territory, XX abroad, None when the row states neither."""
    if country:
        return "XX"
    code = province_code(prov) if prov else None
    return code if code in PROVINCE_CODES else None


def _values(fy: int, r: Row) -> tuple:
    return (fy, r.seq, r.kind, r.dept_no, r.dept_en, r.dept_fr, r.cls, r.cls_en, r.cls_fr, r.payee_en, r.payee_fr,
            r.city, r.city_fr, r.prov, r.prov_fr, r.country, r.country_fr,
            _prov_code(r.prov, r.country) if r.kind == NAMED else None, r.cents, r.n_payees, r.why)


@dataclass(frozen=True)
class Resource:
    """A yearly file as the dataset record lists it."""
    fy: int
    url: str
    resource_id: str
    ckan_modified: str | None
    lang: str = ""                    # '' bilingual, en, fr

    @property
    def file(self) -> str:
        return urlsplit(self.url).path.rsplit("/", 1)[-1] or self.url


def apply(conn: sqlite3.Connection, parsed: Parsed, res: Resource, *, digest: str, etag: str | None,
          last_modified: str | None, stamp: str) -> Linked:
    """Replace the fiscal year's rows with the file's, record the file, and link every row, in one transaction:
    a fault anywhere leaves the rows of the night before."""
    fy = parsed.fy
    assert fy is not None
    try:
        conn.execute("DELETE FROM pa_payments WHERE fy = ?", (fy,))
        conn.executemany(f"INSERT INTO pa_payments ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})",
                         [_values(fy, r) for r in parsed.rows])
        conn.execute("DELETE FROM pa_files WHERE family = ? AND fy = ?", (FAMILY, fy))
        conn.execute(
            "INSERT INTO pa_files (family, fy, lang, resource_id, url, layout, etag, last_modified, ckan_modified, sha256, "
            "rules, rows, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (FAMILY, fy, res.lang, res.resource_id, res.url, parsed.layout, etag, last_modified, res.ckan_modified, digest,
             rules(), parsed.read, stamp))
        conn.execute("DELETE FROM meta WHERE key = ?", (META_HOLD,))
        linked = relink(conn, stamp=stamp, commit=False, full=True)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return linked


# ---------------------------------------------------------------------------
# The link, computed again every night
# ---------------------------------------------------------------------------

_BRACKETS_RE = re.compile(r"\s*\([^()]*\)")
_HEAD_IN_BRACKETS_RE = re.compile(
    r"^(?P<name>.+?)\s*\((?P<head>(?:the\s+)?(?:department|ministry|office|minist[eè]re|bureau)\s+(?:of|de|du|des)(?:\s+the)?)\)\s*(?P<rest>.*)$",
    re.I)


def federal_forms(text: str, places: Places, *own: object) -> list[str]:
    """The forms of a payee's name the federal test keys: as written, without its place, without its brackets,
    and with a wrapper written after the name put back in front ("Health (Department of) (HC)" ->
    "Department of Health")."""
    out: list[str] = []
    for base in (text, strip_place(text, places, *own)):
        m = _HEAD_IN_BRACKETS_RE.match(base)
        inverted = buyers._INVERTED_RE.match(base)
        for form in (base, _BRACKETS_RE.sub("", base).strip(),
                     f"{m.group('head')} {m.group('name')}" if m else "",
                     f"{inverted.group('head')} {inverted.group('name')}" if inverted else ""):
            if form and form not in out:
                out.append(form)
    return out


class FederalIndex:
    """name_key -> buyer ids, from the department names of these files and the buyer titles."""

    def __init__(self, conn: sqlite3.Connection, departments: dict[tuple[str, str | None], str | None]) -> None:
        self.keys: dict[str, set[str]] = defaultdict(set)
        for (en, fr), bid in departments.items():
            for name in (en, fr):
                if name and bid:
                    self.add(name, bid)
        for raw, bid in conn.execute(f"SELECT raw_name, buyer_id FROM buyer_names WHERE source IN ({buyers._titles_in()})"):
            self.add(raw, bid)

    def add(self, name: str, bid: str) -> None:
        key = buyers.name_key(name)
        if key:
            self.keys[key].add(bid)

    def match(self, forms: Iterable[str]) -> tuple[bool, str | None]:
        """(a federal payee, its buyer when one buyer has the key)."""
        for form in forms:
            hit = self.keys.get(buyers.name_key(form))
            if hit:
                return True, next(iter(hit)) if len(hit) == 1 else None
        return False, None


class OrgIds:
    """The live organization an id names: itself, else where organization_aliases sends it; never a new one."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.cache: dict[str, str | None] = {}

    def live(self, oid: str) -> str | None:
        if oid in self.cache:
            return self.cache[oid]
        seen, cur, found = {oid}, oid, None
        while True:
            if self.conn.execute("SELECT 1 FROM organizations WHERE id = ?", (cur,)).fetchone():
                found = cur
                break
            row = self.conn.execute("SELECT new_id FROM organization_aliases WHERE old_id = ?", (cur,)).fetchone()
            if row is None or row[0] in seen:
                break
            cur = row[0]
            seen.add(cur)
        self.cache[oid] = found
        return found


def org_places(conn: sqlite3.Connection, ids: Iterable[str]) -> dict[str, tuple[set[str], set[str]]]:
    """Each organization's provinces and countries, from its main place and every place on its records."""
    out: dict[str, tuple[set[str], set[str]]] = {}
    ordered = sorted(set(ids))
    for i in range(0, len(ordered), 500):
        chunk = ordered[i:i + 500]
        marks = ",".join("?" * len(chunk))
        for sql in (f"SELECT id, province, country FROM organizations WHERE id IN ({marks})",
                    f"SELECT organization_id, province, country FROM organization_places WHERE organization_id IN ({marks})"):
            for oid, prov, country in conn.execute(sql, chunk):
                provinces, countries = out.setdefault(oid, (set(), set()))
                if prov in PROVINCE_CODES:
                    provinces.add(prov)
                if country:
                    countries.add(str(country).upper())
    return out


def place_flag(prov_code: str | None, country: str | None, places: tuple[set[str], set[str]] | None) -> int:
    """1 when the payee's province (its country abroad) is not among the organization's addresses; 0 when it
    is, or when there is nothing to compare."""
    provinces, countries = places or (set(), set())
    if prov_code and prov_code != "XX":
        return 1 if provinces and prov_code not in provinces else 0
    code = country_code(country) if country else None
    return 1 if code and countries and code not in countries else 0


@dataclass
class Linked:
    """What one relink found; the review file's lists."""
    fy: int | None = None             # the newest fiscal year held
    counts: dict[int, Counter] = field(default_factory=lambda: defaultdict(Counter))
    federal: list[tuple] = field(default_factory=list)          # (fy, payee, buyer id)
    loose: list[tuple] = field(default_factory=list)            # (payee, buyer id) the general resolver reads
    flagged: list[tuple] = field(default_factory=list)          # (fy, payee, city, province, organization)
    common: list[tuple] = field(default_factory=list)           # (fy, payee, province, organization)
    keys: list[tuple] = field(default_factory=list)             # (payee, n organizations, their ids)
    departments: list[tuple] = field(default_factory=list)      # (department, French) with no buyer
    blocks_off: list[tuple] = field(default_factory=list)       # (fy, department, class, header, sum)
    short_kept: int = 0               # kept names of two or three words without a legal form
    changed: int = 0                  # rows whose link, kind or buyer moved tonight


def _first_word(norm: str) -> str:
    word = norm.split(" ", 1)[0] if norm else ""
    return ABBREVIATIONS.get(word, word)


def key_candidates(conn: sqlite3.Connection, names: dict[str, str]) -> dict[str, list[str]]:
    """For each unlinked payee spelling (spelling -> its normalized form), the organizations its match key
    names, read from the organizations whose normalized name starts with the same word (an index range, at most
    KEY_CANDIDATES_PER_WORD a word)."""
    keyed = {raw: k for raw in names if (k := match_key(raw)) is not None}
    if not keyed:
        return {}
    by_key: dict[str, set[str]] = defaultdict(set)
    for word in sorted({_first_word(norm) for norm in names.values() if norm}):
        rows = conn.execute("SELECT id, display_name FROM organizations WHERE norm_name = ? OR (norm_name >= ? AND norm_name < ?) "
                            "LIMIT ?", (word, word + " ", word + "!", KEY_CANDIDATES_PER_WORD)).fetchall()
        for oid, display in rows:
            k = match_key(display)
            if k is not None:
                by_key[k.key].add(oid)
    return {raw: sorted(by_key[k.key]) for raw, k in keyed.items() if by_key.get(k.key)}


def relink(conn: sqlite3.Connection, *, stamp: str, commit: bool = True, full: bool = False) -> Linked:
    """Every row's buyer, and every named row's kind (named or federal), organization, flag and reason,
    computed again from the stored names; only the rows that changed are written.

    full also works out the review's two costly lists (the match key candidates, an index range of the
    organizations for each spelling's first word, and the general resolver's federal readings) and keeps them
    in META_REVIEW; a night without it reads them from there."""
    out = Linked()
    rows = conn.execute(
        "SELECT fy, seq, kind, dept_no, dept_en, dept_fr, buyer_id, cls, payee_raw, payee_fr, payee_norm, city, city_fr, prov, "
        "prov_fr, country, country_fr, prov_code, cents, payee_buyer_id, organization_id, pf, why FROM pa_payments "
        "ORDER BY fy, seq").fetchall()
    if not rows:
        return out
    out.fy = max(r["fy"] for r in rows)
    departments: dict[tuple[str, str | None], str | None] = {}
    for r in rows:
        pair = (r["dept_en"], r["dept_fr"])
        if pair not in departments:
            departments[pair] = buyers.resolve(conn, r["dept_en"], r["dept_fr"], source=SOURCE, now=stamp)
            if departments[pair] is None:
                out.departments.append(pair)
    federal = FederalIndex(conn, departments)
    places: dict[int, Places] = defaultdict(Places)
    for r in rows:
        places[r["fy"]].add(r["city"], r["city_fr"], r["prov"], r["prov_fr"])
    ids = OrgIds(conn)
    decided: dict[tuple[int, int], dict] = {}
    pending: list[tuple[sqlite3.Row, str, str | None, str]] = []
    for r in rows:
        bid = departments[(r["dept_en"], r["dept_fr"])]
        new = {"buyer_id": bid, "kind": r["kind"], "payee_norm": r["payee_norm"], "payee_buyer_id": None,
               "organization_id": None, "pf": 0, "why": r["why"]}
        decided[(r["fy"], r["seq"])] = new
        if r["kind"] not in (NAMED, FEDERAL):
            continue
        own = (r["city"], r["city_fr"], r["country"], r["country_fr"])
        en = r["payee_raw"] or r["payee_fr"] or ""
        stripped = strip_place(en, places[r["fy"]], *own)
        norm = norm_name(stripped)
        new["payee_norm"] = norm or None
        forms = federal_forms(en, places[r["fy"]], *own) + (federal_forms(r["payee_fr"], places[r["fy"]], *own) if r["payee_fr"] else [])
        is_federal, payee_bid = federal.match(forms)
        if is_federal:
            new.update(kind=FEDERAL, payee_buyer_id=payee_bid, why=None)
            continue
        new.update(kind=NAMED, why="none")
        if not norm or matching.is_placeholder(stripped) or organizations.is_not_organization(norm):
            continue
        oid = ids.live(org_id(norm))
        if oid is None:
            pending.append((r, stripped, None, norm))
            continue
        pending.append((r, stripped, oid, norm))
    where = org_places(conn, (oid for _, _, oid, _ in pending if oid))
    unlinked: dict[str, str] = {}
    for r, stripped, oid, norm in pending:
        new = decided[(r["fy"], r["seq"])]
        if oid is None:
            unlinked[stripped] = norm
            continue
        prov = r["prov_code"]
        if matching.is_common_name(norm) and not (prov and prov in where.get(oid, (set(), set()))[0]):
            new["why"] = "common"
            out.common.append((r["fy"], r["payee_raw"], prov or r["country"] or "", oid))
            continue
        new.update(organization_id=oid, why=None, pf=place_flag(prov, r["country"], where.get(oid)))
        if new["pf"]:
            out.flagged.append((r["fy"], r["payee_raw"], r["city"] or "", prov or r["country"] or "", oid))
    try:
        kept = json.loads(get_meta(conn, META_REVIEW) or "null")
    except ValueError:
        kept = None
    if full or not isinstance(kept, dict):
        candidates = key_candidates(conn, unlinked) if unlinked else {}
    else:
        stored = kept.get("keys") if isinstance(kept.get("keys"), dict) else {}
        candidates = {raw: list(stored[raw]) for raw in unlinked if raw in stored}
    for r, stripped, oid, _norm in pending:
        if oid is None and stripped in candidates:
            decided[(r["fy"], r["seq"])]["why"] = "key"
    out.keys = [(raw, len(found), found) for raw, found in sorted(candidates.items())]
    changed = []
    for r in rows:
        new = decided[(r["fy"], r["seq"])]
        if any(new[k] != r[k] for k in new):
            changed.append((new["buyer_id"], new["kind"], new["payee_norm"], new["payee_buyer_id"], new["organization_id"],
                            new["pf"], new["why"], r["fy"], r["seq"]))
        c = out.counts[r["fy"]]
        c["rows"] += 1
        c[new["kind"]] += 1
        if new["kind"] == NAMED:
            c["linked" if new["organization_id"] else "unlinked"] += 1
            c["flagged"] += new["pf"]
            if not new["organization_id"]:
                c[f"unlinked_{new['why']}"] += 1
            if new["organization_id"] is None and new["payee_norm"] and len(new["payee_norm"].split()) in (2, 3) \
                    and not re.search(r"\b(?:inc|ltd|llp|lp|corp|corporation|limited|ltee|ulc|llc)\b", (r["payee_raw"] or "").casefold()):
                out.short_kept += 1
        if new["kind"] == WITHHELD:
            c[f"withheld_{r['why']}"] += 1
        if new["kind"] == FEDERAL:
            out.federal.append((r["fy"], r["payee_raw"], new["payee_buyer_id"] or ""))
    conn.executemany("UPDATE pa_payments SET buyer_id = ?, kind = ?, payee_norm = ?, payee_buyer_id = ?, organization_id = ?, "
                     "pf = ?, why = ? WHERE fy = ? AND seq = ?", changed)
    for fy in sorted({r["fy"] for r in rows}):
        _, off = check_blocks((r["dept_no"], r["dept_en"], r["cls"], r["kind"], r["cents"]) for r in rows if r["fy"] == fy)
        out.blocks_off += [(fy, *b) for b in off]
    if full or not isinstance(kept, dict):
        # The general resolver's reading of each named payee the strict test leaves an organization: for the
        # review file only, and never written (buyers._match makes no buyer and records no spelling).
        seen: set[str] = set()
        for r in rows:
            new = decided[(r["fy"], r["seq"])]
            if new["kind"] == NAMED and r["payee_raw"] and r["payee_raw"] not in seen:
                seen.add(r["payee_raw"])
                hit = buyers._match(conn, r["payee_raw"], r["payee_fr"] or "")
                if hit:
                    out.loose.append((r["payee_raw"], hit))
        set_meta(conn, META_REVIEW, json.dumps({"keys": candidates, "loose": out.loose}, ensure_ascii=False, sort_keys=True))
    else:
        out.loose = [tuple(x) for x in kept.get("loose") or [] if isinstance(x, list) and len(x) == 2]
    if commit:
        conn.commit()
    out.changed = len(changed)
    return out


# ---------------------------------------------------------------------------
# The stage
# ---------------------------------------------------------------------------

def newest_resource(record: object) -> Resource | None:
    """The newest fiscal year's file the dataset record lists: the bilingual one when the year has it."""
    result = record.get("result") if isinstance(record, dict) else None
    if not isinstance(record, dict) or not record.get("success") or not isinstance(result, dict):
        raise ValueError("the dataset record did not answer with a result")
    best: tuple | None = None
    for res in result.get("resources") or []:
        if not isinstance(res, dict):
            continue
        url = str(res.get("url") or "")
        m = FILE_RE.search(url)
        if not m:
            continue
        year, lang = int(m.group(1)), (m.group(2) or "").lower()
        lang = {"eng": "en", "fra": "fr"}.get(lang, "")
        rank = (year, lang == "", lang == "en")
        if best is None or rank > best[0]:
            best = (rank, Resource(fy=year - 1, url=url, resource_id=str(res.get("id") or ""),
                                   ckan_modified=str(res.get("last_modified") or "") or None, lang=lang))
    return best[1] if best else None


def released(path: Path | None = None) -> str | None:
    """The SHA-256 (or its first 12 characters or more) the operator wrote to config.PA_RELEASE, or None."""
    try:
        text = (path or config.PA_RELEASE).read_text(encoding="utf-8").strip().lower()
    except OSError:
        return None
    token = text.split()[0] if text else ""
    return token if re.fullmatch(r"[0-9a-f]{12,64}", token) else None


@dataclass
class Result:
    state: str = ""                   # read | unchanged | not due | no sample | held | refused | not read
    fy: int | None = None
    read: int = 0                     # data rows read tonight
    written: int = 0
    notices: list[str] = field(default_factory=list)
    linked: Linked | None = None


def _file_row(conn: sqlite3.Connection, fy: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM pa_files WHERE family = ? AND fy = ?", (FAMILY, fy)).fetchone()


def _hold(conn: sqlite3.Connection, why: str, res: Resource, digest: str | None, etag: str | None,
          last_modified: str | None, fy: int | None) -> None:
    set_meta(conn, META_HOLD, json.dumps({"why": why, "fy": fy, "url": res.url, "ckan_modified": res.ckan_modified,
                                          "sha256": digest, "etag": etag, "last_modified": last_modified, "rules": rules()},
                                         sort_keys=True))
    conn.commit()


def held_copy(conn: sqlite3.Connection) -> dict | None:
    try:
        value = json.loads(get_meta(conn, META_HOLD) or "null")
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _read_copy(conn: sqlite3.Connection, path: Path, res: Resource, result: Result, drops: matching.PersonDrops, *,
               digest: str, etag: str | None, last_modified: str | None, stamp: str, partial_tail: bool = False,
               release_path: Path | None = None) -> None:
    """Read one copy and apply it, unless its layout is not known or it is held."""
    try:
        parsed = read_file(path, drops, partial_tail=partial_tail)
    except LayoutError as exc:
        _hold(conn, f"layout: {exc}"[:400], res, digest, etag, last_modified, None)
        result.state = "refused"
        result.notices.append(f"public accounts: {res.file} was not read ({exc}); the rows of the copy applied before stand")
        return
    result.read, result.fy = parsed.read, parsed.fy
    if parsed.extra:
        result.notices.append(f"public accounts: {res.file} has columns the stage does not read: {', '.join(parsed.extra[:10])}")
    if parsed.skipped:
        result.notices.append(f"public accounts: {parsed.skipped} rows of {res.file} without a fiscal year, a department "
                              "or a class, or cut short, were skipped")
    if res.fy != parsed.fy and res.resource_id != "sample":
        result.notices.append(f"public accounts: {res.file} holds fiscal {parsed.fy}, not {res.fy} as its name says")
    free = released(release_path)
    let_through = bool(free and digest.startswith(free))
    previous = conn.execute("SELECT COUNT(*) FROM pa_payments WHERE fy = ? AND kind IN (?, ?, ?)",
                            (parsed.fy, NAMED, WITHHELD, FEDERAL)).fetchone()[0]
    reasons = []
    if previous and parsed.named < previous * (1 - HOLD_FALL):
        reasons.append(f"{parsed.named} named rows against {previous} in the copy applied before (more than "
                       f"{int(HOLD_FALL * 100)} percent fewer)")
    if parsed.blocks and len(parsed.blocks_off) > parsed.blocks * BLOCKS_OFF_SHARE:
        reasons.append(f"{len(parsed.blocks_off)} of {parsed.blocks} class blocks do not add up to their total")
    if reasons and not let_through:
        _hold(conn, "; ".join(reasons), res, digest, etag, last_modified, parsed.fy)
        result.state = "held"
        result.notices.append(f"public accounts: {res.file} (sha256 {digest[:12]}) is held: {'; '.join(reasons)}. The rows "
                              f"applied before stand. Release it by writing {digest[:12]} to "
                              f"awardwatch_pipeline/data/{config.PA_RELEASE.name}")
        return
    if parsed.blocks_off:
        result.notices.append(f"public accounts: {len(parsed.blocks_off)} of {parsed.blocks} class blocks of {res.file} do not "
                              "add up to their total; they are listed in the review file")
    result.linked = apply(conn, parsed, res, digest=digest, etag=etag, last_modified=last_modified, stamp=stamp)
    result.state, result.written = "read", len(parsed.rows)


def ckan_due(conn: sqlite3.Connection, stamp: str) -> bool:
    """The dataset record is read nightly in the release season (September to January) and weekly otherwise."""
    age = hours_since(conn, META_CHECKED, now=stamp)
    if age is None:
        return True
    month = int(stamp[5:7])
    return age >= (CHECK_HOURS_SEASON if month in SEASON_MONTHS else CHECK_HOURS_OTHER)


def _fetch(conn: sqlite3.Connection, client: PoliteClient, res: Resource, result: Result, drops: matching.PersonDrops, *,
           stamp: str, work_dir: Path | None, conditional: sqlite3.Row | None) -> None:
    """Download one file (conditional on the copy applied when there is one) and read it when it changed."""
    path = (work_dir or config.WORK_DIR) / f"pa-{res.file}"
    try:
        got = client.download_if_changed(res.url, path, etag=conditional["etag"] if conditional else None,
                                         last_modified=conditional["last_modified"] if conditional else None,
                                         timeout=TIMEOUT_S)
        if got is None:
            # Not modified: the record changed, the file did not. Nothing is read again.
            conn.execute("UPDATE pa_files SET ckan_modified = ?, resource_id = ? WHERE family = ? AND fy = ?",
                         (res.ckan_modified, res.resource_id, FAMILY, res.fy))
            conn.commit()
            result.state = "unchanged"
            return
        digest = sha256(path)
        same = conditional is not None and conditional["sha256"] == digest and conditional["rules"] == rules()
        if same:
            conn.execute("UPDATE pa_files SET ckan_modified = ?, resource_id = ?, etag = ?, last_modified = ? "
                         "WHERE family = ? AND fy = ?", (res.ckan_modified, res.resource_id, got.etag, got.last_modified,
                                                         FAMILY, res.fy))
            conn.commit()
            result.state = "unchanged"
            return
        _read_copy(conn, path, res, result, drops, digest=digest, etag=got.etag, last_modified=got.last_modified, stamp=stamp)
    finally:
        path.unlink(missing_ok=True)


def refresh(conn: sqlite3.Connection, client: PoliteClient | None, result: Result, drops: matching.PersonDrops, *,
            stamp: str, samples: Path | None = None, work_dir: Path | None = None) -> None:
    """Read the newest year's file when it is new, changed or read under other rules; never raises for the
    network, the record or the file (those are notices)."""
    if samples is not None:
        path = samples / SAMPLE_NAME
        if not path.exists():
            result.state = "no sample"
            result.notices.append(f"no {SAMPLE_NAME} in the samples folder (samples run)")
            return
        digest = sha256(path)
        applied = conn.execute("SELECT sha256, rules FROM pa_files WHERE family = ? AND url = ?",
                               (FAMILY, f"samples/{SAMPLE_NAME}")).fetchone()
        if applied and applied["sha256"] == digest and applied["rules"] == rules():
            result.state = "unchanged"
            return
        res = Resource(fy=0, url=f"samples/{SAMPLE_NAME}", resource_id="sample", ckan_modified=None)
        _read_copy(conn, path, res, result, drops, digest=digest, etag=None, last_modified=None, stamp=stamp, partial_tail=True)
        return
    assert client is not None
    # A year applied under other rules is read again tonight from the address it was read from.
    current = rules()
    stale = conn.execute("SELECT * FROM pa_files WHERE family = ? AND rules IS NOT ? ORDER BY fy DESC", (FAMILY, current)).fetchall()
    for row in stale:
        res = Resource(fy=row["fy"], url=row["url"], resource_id=row["resource_id"], ckan_modified=row["ckan_modified"],
                       lang=row["lang"])
        try:
            _fetch(conn, client, res, result, drops, stamp=stamp, work_dir=work_dir, conditional=None)
        except (FetchError, AbortRun, OSError) as exc:
            conn.rollback()
            result.notices.append(f"public accounts: {res.file} could not be read again under new rules ({_short(exc)}); "
                                  "its rows stand as they were read")
    if not ckan_due(conn, stamp):
        result.state = result.state or "not due"
        return
    try:
        record = client.get_json(config.CKAN_PACKAGE_SHOW.format(dataset=config.PA_SERVICES_DATASET), timeout=60)
        res = newest_resource(record)
    except (FetchError, AbortRun, OSError, ValueError) as exc:
        conn.rollback()
        result.state = result.state or "not read"
        result.notices.append(f"public accounts: the dataset record could not be read ({_short(exc)}); the rows stand")
        return
    set_meta(conn, META_CHECKED, stamp)
    conn.commit()
    if res is None:
        result.state = result.state or "not read"
        result.notices.append("public accounts: the dataset record lists no yearly file; the rows stand")
        return
    applied = _file_row(conn, res.fy)
    if applied and applied["url"] == res.url and applied["ckan_modified"] == res.ckan_modified and applied["rules"] == current:
        result.state = result.state or "unchanged"
        return
    hold = held_copy(conn)
    if hold and hold.get("url") == res.url and hold.get("ckan_modified") == res.ckan_modified and hold.get("rules") == current:
        free = released()
        if str(hold.get("why", "")).startswith("layout") or not (free and str(hold.get("sha256") or "").startswith(free)):
            result.state = "refused" if str(hold.get("why", "")).startswith("layout") else "held"
            result.notices.append(f"public accounts: {res.file} is still {result.state} ({hold.get('why')}); the rows stand")
            return
    conditional = applied if applied and applied["url"] == res.url and applied["rules"] == current else None
    try:
        _fetch(conn, client, res, result, drops, stamp=stamp, work_dir=work_dir, conditional=conditional)
    except (FetchError, AbortRun, OSError) as exc:
        conn.rollback()
        result.state = "not read"
        result.notices.append(f"public accounts: {res.file} could not be downloaded ({_short(exc)}); the rows stand")


def _short(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:200]


def detail(conn: sqlite3.Connection, result: Result) -> str:
    """The run status line: public, counts only, no name."""
    linked = result.linked or Linked()
    fy = linked.fy
    c = linked.counts.get(fy, Counter()) if fy is not None else Counter()
    files = conn.execute("SELECT COUNT(*) FROM pa_files WHERE family = ?", (FAMILY,)).fetchone()[0]
    hold = held_copy(conn)
    label = f"{fy}-{(fy + 1) % 100:02d}" if fy is not None else "none"
    held = "none" if not hold else str(hold.get("fy") or "layout")
    return (f"{result.state or 'unchanged'} fy={label} files={files} rows={c['rows']} named={c[NAMED]} linked={c['linked']} "
            f"unlinked={c['unlinked']} withheld={withheld_rows(c)} federal={c[FEDERAL]} flagged={c['flagged']} held={held}")


def withheld_rows(counts: Counter) -> int:
    return sum(v for k, v in counts.items() if k.startswith("withheld_"))


def run(conn: sqlite3.Connection, client: PoliteClient | None, *, now: str | None = None, samples: Path | None = None,
        work_dir: Path | None = None, review_dir: Path | None = None) -> Result:
    """The public_accounts stage: the newest year's file when it changed, then the nightly relink, the review
    files and one log row. A fault of the network or the file is a notice; the stage ends ok."""
    stamp = now or now_iso()
    result = Result()
    drops = matching.PersonDrops()
    buyers.take_notices(conn)
    buyers.take_rejects(conn)
    conn.commit()
    refresh(conn, client, result, drops, stamp=stamp, samples=samples, work_dir=work_dir)
    if result.linked is None:
        # Every night, whatever the record said: tonight's merges and buyer changes move the payments.
        try:
            result.linked = relink(conn, stamp=stamp)
        except BaseException:
            conn.rollback()
            raise
    folder = review_dir or config.OUT_DIR / "review"
    if drops.rows:
        shown = drops.write(folder / PERSONS_FILE, what="Public Accounts, professional and special services", stamp=stamp,
                            withheld="payee withheld")
        if shown:
            result.notices.append(shown)
    reviewed = write_review(conn, result.linked, folder / REVIEW_FILE, stamp=stamp)
    if reviewed and result.state == "read":
        result.notices.append(f"public accounts: a new file was applied; the review is in {reviewed}")
    made = buyers.take_notices(conn)
    if made:
        result.notices.append(f"{len(made)} buyers not in CKAN or the seed: {'; '.join(made[:15])}")
    buyers.take_rejects(conn)
    line = detail(conn, result)
    log.info("public_accounts: %s", line)
    newest = result.linked.counts.get(result.linked.fy, Counter()) if result.linked.fy is not None else Counter()
    log_run(conn, SOURCE, detail=line[:900], rows_in=result.read, rows_new=result.written, excluded=withheld_rows(newest),
            notice=" | ".join(result.notices) or None)
    return result


# ---------------------------------------------------------------------------
# The review file (private: no step exports, logs or uploads it)
# ---------------------------------------------------------------------------

def write_review(conn: sqlite3.Connection, linked: Linked, path: Path, *, stamp: str) -> str | None:
    """The operator's yearly read: the files, the counts, and each list the rules leave for a person to look at.
    It names businesses and departments, never a person: a withheld row holds no name to list."""
    files = conn.execute("SELECT * FROM pa_files WHERE family = ? ORDER BY fy DESC", (FAMILY,)).fetchall()
    if not files and not linked.counts:
        path.unlink(missing_ok=True)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    cap = REVIEW_LIST_MAX

    def section(title: str, head: str, items: list[tuple]) -> list[str]:
        lines = ["", f"## {title}: {len(items)}" + (f", the first {cap} listed" if len(items) > cap else ""), f"# {head}"]
        return lines + ["\t".join("" if x is None else str(x) for x in item) for item in items[:cap]]

    out = [f"# Public Accounts of Canada, professional and special services: the run of {stamp}, rules {rules()}. "
           "For the operator: no step publishes this file, and it names no person.",
           "", "## Files applied", "# fy\tfile\tlayout\tsha256\trows\tapplied_at\tckan_modified"]
    out += [f"{f['fy']}\t{f['url'].rsplit('/', 1)[-1]}\t{f['layout']}\t{(f['sha256'] or '')[:12]}\t{f['rows']}\t{f['applied_at']}\t"
            f"{f['ckan_modified'] or ''}" for f in files]
    hold = held_copy(conn)
    if hold:
        out += ["", f"## Held or refused: {hold.get('why')} (sha256 {str(hold.get('sha256') or '')[:12]}, {hold.get('url')})"]
    keys = ("rows", HEADER, UNDER, NAMED, "linked", "unlinked", "unlinked_common", "unlinked_key", "unlinked_none", "flagged",
            FEDERAL, "withheld_1", "withheld_2", "withheld_3", "withheld_4", "withheld_5", "withheld_seed")
    out += ["", "## Counts by fiscal year (withheld_<n>: by the person rule that withheld the row)", "# fy\t" + "\t".join(keys)]
    out += [f"{fy}\t" + "\t".join(str(linked.counts[fy].get(k, 0)) for k in keys) for fy in sorted(linked.counts, reverse=True)]
    out += ["", f"## Kept names of two or three words without a legal form and with no profile: {linked.short_kept} "
            "(counted, not listed)"]
    out += section("Federal payees by the strict test", "fy\tpayee as written\tbuyer id (blank: two or more)", linked.federal)
    out += section("The general resolver's further federal readings, not taken (an alias seed row makes one federal)",
                   "payee as written\tbuyer id", linked.loose)
    out += section("Links whose province is not among the organization's addresses (kept, flagged)",
                   "fy\tpayee as written\tcity\tprovince or country\torganization", linked.flagged)
    out += section("Common names left unlinked (the payee's province is not the organization's)",
                   "fy\tpayee as written\tprovince or country\torganization", linked.common)
    out += section("Match key candidates, never linked", "payee\torganizations\tids",
                   [(raw, n, ", ".join(ids[:5])) for raw, n, ids in linked.keys])
    out += section("Departments that resolved to no buyer", "department\tFrench", linked.departments)
    out += section("Class blocks that do not add up", "fy\tdepartment\tclass\theader cents\tsum cents", linked.blocks_off)
    path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    try:
        return path.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


# ---------------------------------------------------------------------------
# What the export writes (export_static calls these, each guarded)
# ---------------------------------------------------------------------------

def loaded_years(conn: sqlite3.Connection) -> list[int]:
    """The fiscal years of the services files applied, newest first."""
    return [r[0] for r in conn.execute("SELECT DISTINCT fy FROM pa_files WHERE family = ? ORDER BY fy DESC", (FAMILY,))]


def _place(r: sqlite3.Row) -> str | list[str] | None:
    """A row's place as the site reads it: a province's code, a country (or a state abroad) in both languages, or None."""
    if r["prov_code"] in PROVINCE_CODES and not r["country"]:
        return r["prov_code"]
    if r["country"]:
        return [r["country"], r["country_fr"] or r["country"]]
    if r["prov"]:
        return [r["prov"], r["prov_fr"] or r["prov"]]
    return None


def _dept_key(r: sqlite3.Row, listed: Collection) -> str:
    """The department's key on a profile: its buyer id when the buyer has a page, else pa: and its number."""
    if r["buyer_id"] and r["buyer_id"] in listed:
        return r["buyer_id"]
    return "pa:" + (r["dept_no"] or re.sub(r"[^a-z0-9]+", "-", fold(r["dept_en"]))[:40])


_ROW_SQL = ("SELECT fy, seq, kind, dept_no, dept_en, dept_fr, buyer_id, cls, cls_en, cls_fr, payee_raw, payee_fr, city, city_fr, "
            "prov, prov_fr, country, country_fr, prov_code, cents, n_payees, organization_id, pf FROM pa_payments")


def profile_blocks(conn: sqlite3.Connection, *, orgs: Collection, listed: Collection,
                   buyer_names: dict[str, tuple[str | None, str | None]]) -> dict[str, dict]:
    """The "public_accounts" block of each organization with a linked row in the newest PA_FREE_YEARS fiscal
    years held: per year its rows (largest first, PA_PROFILE_ROWS at most), how many there are, their sum and
    the departments they come from; the names of those departments and classes; the years held. Payments of
    one file and one year only: no figure here is ever added to a contract value."""
    years = loaded_years(conn)
    shown = years[:PA_FREE_YEARS]
    if not shown:
        return {}
    marks = ",".join("?" * len(shown))
    rows = conn.execute(f"{_ROW_SQL} WHERE kind = ? AND organization_id IS NOT NULL AND fy IN ({marks}) "
                        "ORDER BY organization_id, fy DESC, cents DESC, seq", (NAMED, *shown)).fetchall()
    out: dict[str, dict] = {}
    for oid, mine in _by(rows, "organization_id").items():
        if oid not in orgs:
            continue
        depts: dict[str, list] = {}
        classes: dict[str, list] = {}
        services = []
        for fy, year_rows in _by(mine, "fy").items():
            keys = [_dept_key(r, listed) for r in year_rows]
            for r, key in zip(year_rows, keys):
                if key not in depts:
                    names = buyer_names.get(r["buyer_id"]) if key == r["buyer_id"] else None
                    depts[key] = [(names or (None, None))[0] or r["dept_en"], (names or (None, None))[1] or r["dept_fr"]]
                classes.setdefault(r["cls"], [r["cls_en"] or r["cls"], r["cls_fr"] or r["cls_en"] or r["cls"]])
            services.append({
                "fy": fy, "n": len(year_rows), "total": dollars(sum(r["cents"] or 0 for r in year_rows)), "d": len(set(keys)),
                "rows": [[key, r["cls"], dollars(r["cents"]), r["payee_raw"], r["payee_fr"], r["city"], r["city_fr"], _place(r), r["pf"]]
                         for r, key in list(zip(year_rows, keys))[:PA_PROFILE_ROWS]],
            })
        out[oid] = {"v": 1, "services": sorted(services, key=lambda s: -s["fy"]), "buyers": dict(sorted(depts.items())),
                    "classes": dict(sorted(classes.items())), "loaded": [min(years), max(years)]}
    return out


def buyer_blocks(conn: sqlite3.Connection, *, orgs: Collection, listed: Collection) -> dict[str, dict]:
    """The "public_accounts" block of each listed buyer with a class of the newest fiscal year held: each class's
    total as published and how it splits (named organizations, under the threshold, federal institutions, a
    count of the persons withheld), the newest year's PA_BUYER_PAYEES largest organization payees (linked when
    a profile holds them), and the buyer's total of the file for each of the newest PA_FREE_YEARS years."""
    years = loaded_years(conn)
    if not years:
        return {}
    newest, shown = years[0], years[:PA_FREE_YEARS]
    marks = ",".join("?" * len(shown))
    year_totals: dict[str, dict[int, int]] = defaultdict(dict)
    for bid, fy, total in conn.execute(f"SELECT buyer_id, fy, SUM(cents) FROM pa_payments WHERE kind = ? AND buyer_id IS NOT NULL "
                                       f"AND fy IN ({marks}) GROUP BY buyer_id, fy", (HEADER, *shown)):
        year_totals[bid][fy] = total or 0
    rows = conn.execute(f"{_ROW_SQL} WHERE fy = ? AND buyer_id IS NOT NULL ORDER BY buyer_id, cls, seq", (newest,)).fetchall()
    out: dict[str, dict] = {}
    for bid, mine in _by(rows, "buyer_id").items():
        if bid not in listed:
            continue
        classes: dict[str, dict] = {}
        for r in mine:
            c = classes.setdefault(r["cls"], {"cls": r["cls"], "en": r["cls_en"] or r["cls"], "fr": r["cls_fr"] or r["cls_en"] or r["cls"],
                                              "total": 0, "named": [0, 0], "under": [0, 0], "federal": [0, 0], "withheld": 0})
            amount = r["cents"] or 0
            if r["kind"] == HEADER:
                c["total"] += amount
            elif r["kind"] == NAMED:
                c["named"][0] += 1
                c["named"][1] += amount
            elif r["kind"] == UNDER:
                c["under"][0] = None if c["under"][0] is None or r["n_payees"] is None else c["under"][0] + r["n_payees"]
                c["under"][1] += amount
            elif r["kind"] == FEDERAL:
                c["federal"][0] += 1
                c["federal"][1] += amount
            elif r["kind"] == WITHHELD:
                c["withheld"] += 1
        for c in classes.values():
            c["total"] = dollars(c["total"])
            for part in ("named", "under", "federal"):
                c[part][1] = dollars(c[part][1])
        named = sorted((r for r in mine if r["kind"] == NAMED), key=lambda r: (-(r["cents"] or 0), r["seq"]))
        out[bid] = {
            "v": 1, "fy": newest,
            "classes": sorted(classes.values(), key=lambda c: (-(c["total"] or 0), c["cls"])),
            "payees": [[r["payee_raw"], r["payee_fr"], r["organization_id"] if r["organization_id"] in orgs else None, r["cls"],
                        dollars(r["cents"]), r["city"], r["city_fr"], _place(r)] for r in named[:PA_BUYER_PAYEES]],
            "named_rows": len(named),
            "years": [[fy, dollars(year_totals[bid][fy])] for fy in shown if fy in year_totals.get(bid, {})],
        }
    return out


def _by(rows: Iterable[sqlite3.Row], column: str) -> dict:
    out: dict = {}
    for r in rows:
        out.setdefault(r[column], []).append(r)
    return out


def source_rows(conn: sqlite3.Connection, http_date_iso) -> list[dict]:
    """stats.json "sources": one row per file applied, newest year first."""
    return [{"source": STATS_SOURCE, "file": f["url"].rsplit("/", 1)[-1], "last_read": f["applied_at"],
             "last_modified": http_date_iso(f["last_modified"]), "last_modified_http": f["last_modified"], "loaded": True}
            for f in conn.execute("SELECT url, applied_at, last_modified FROM pa_files WHERE family = ? ORDER BY fy DESC", (FAMILY,))]
