"""Atom feeds of new tender and award notices and of contracts ending soon, written by the nightly export.

Why static files: a feed reader, a Slack or Teams channel or a feed-to-email
service polls a feed every few minutes to hours. Served from /data/feeds/ as
static assets, a poll costs nothing and counts against no daily allowance. The
site never learns who subscribes and holds no reader address.

Three events, each its own feed:
  tenders   a CanadaBuys tender notice, the night it was first seen; a notice
            whose closing day is before the data date has closed and is left
            out (normalize.closing_day, the rule the open list follows)
  awards    a CanadaBuys award notice, the night it was first seen
  expiring  a contract of the expiring-contracts radar (expiring.py), the night
            its end date came within 91 days (expiring_contracts.entered_3m):
            each contract once, about three months before it ends

Scopes: Canada (always written), UNSPSC segment (a notice with codes in two
segments is in both), province of delivery (tenders only: an award notice's
delivery regions are often blank; stated or derived, as the tenders page's
province filter reads them, places.py) and buyer (the expiring feeds: Canada,
segment and buyer). A scoped feed whose newest entry
was first seen more than FRESH_DAYS ago is not written, so the folder holds
the feeds someone could still be waiting on rather than one per buyer and
segment ever seen.

Pages (RFC 5005, paged feeds). A night can add thousands of entries and a
reader polls the feed's first file, which holds the newest MAX_ENTRIES. When
the newest night holds more, the rest of that night's entries follow in
<event>-2.xml, <event>-3.xml and so on (MAX_PAGES files at most), each
linked from the one before by rel="next" and back by rel="previous" and
rel="first", so a reader that pages follows the whole night. Older nights
are not paged: a reader that polls once a day has seen them.

Entries are bilingual: one feed per scope and event, its titles and summaries
in English and French; a title is the publisher's text and goes through
export.scrub like every exported field. Ids are tag URIs built from the
notice's reference (and, for the radar, the night the row entered), so
a rebuilt database gives the same ids and a reader never sees an old entry
twice. A supplier the loaders withheld as a private individual is never
named: the entry says the supplier is withheld.

Output (under data/out/static/feeds):
  index.json                       every feed written, for the site's /feeds page
  canada/<event>.xml               and canada/<event>-<n>.xml for a night's later pages, in every scope
  segment/<nn>/<event>.xml
  prov/<pp>/tenders.xml            pp in lower case (the key in index.json is the upper-case code)
  buyer/<id>/<event>.xml

Every file is written deterministically (no wall-clock time), so a feed with
no new entry keeps its bytes and the deploy skips it.
"""

from __future__ import annotations

import json
import re
import sqlite3
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

from . import config, organizations
from .export import scrub
from .normalize import PROVINCE_CODES, closing_day
from .sources.buyers import public_spelling

ATOM_NS = "http://www.w3.org/2005/Atom"
ET.register_namespace("", ATOM_NS)
# Fixed, not derived from SITE_URL: an entry id must never change, whatever
# address the site is served from.
TAG = "tag:awardwatch.ca,2026:"
SITE_NAME = "Award Watch"

MAX_ENTRIES = 50
# A feed's files at most, its first included: 20 pages hold a night of 1,000 entries.
MAX_PAGES = 20
FRESH_DAYS = 90

EVENTS = ["tenders", "awards", "expiring"]
SCOPE_ORDER = {"canada": 0, "segment": 1, "prov": 2, "buyer": 3}

PROVINCE_NAME = {
    "AB": ("Alberta", "Alberta"),
    "BC": ("British Columbia", "Colombie-Britannique"),
    "MB": ("Manitoba", "Manitoba"),
    "NB": ("New Brunswick", "Nouveau-Brunswick"),
    "NL": ("Newfoundland and Labrador", "Terre-Neuve-et-Labrador"),
    "NS": ("Nova Scotia", "Nouvelle-Écosse"),
    "NT": ("Northwest Territories", "Territoires du Nord-Ouest"),
    "NU": ("Nunavut", "Nunavut"),
    "ON": ("Ontario", "Ontario"),
    "PE": ("Prince Edward Island", "Île-du-Prince-Édouard"),
    "QC": ("Quebec", "Québec"),
    "SK": ("Saskatchewan", "Saskatchewan"),
    "YT": ("Yukon", "Yukon"),
}

EVENT_NAME = {
    "tenders": ("New tender notices", "Nouveaux avis d’appel d’offres"),
    "awards": ("New award notices", "Nouveaux avis d’attribution"),
    "expiring": ("Contracts ending within three months", "Contrats qui prennent fin d’ici trois mois"),
}
EVENT_ABOUT = {
    "tenders": (
        "CanadaBuys tender notices, newest first by the date Award Watch first recorded them. "
        "Closing states are as of the data date; closing times are Eastern time (ET).",
        "Avis d’appel d’offres d’AchatsCanada, les plus récents en premier selon la date où Award Watch les a relevés. "
        "Les états de clôture sont ceux de la date des données; les heures de clôture sont en heure de l’Est (HE).",
    ),
    "awards": (
        "CanadaBuys award notices, newest first by the date Award Watch first recorded them.",
        "Avis d’attribution d’AchatsCanada, les plus récents en premier selon la date où Award Watch les a relevés.",
    ),
    "expiring": (
        "Award notices, contract history records and published contracts whose end date came within 91 days, "
        "each contract once, newest first by the date Award Watch recorded it.",
        "Avis d’attribution, contrats octroyés et contrats publiés dont la date de fin est à moins de 91 jours, "
        "chaque contrat une seule fois, les plus récents en premier selon la date où Award Watch l’a relevé.",
    ),
}
RIGHTS = (
    "CanadaBuys tender and award notices: Public Services and Procurement Canada, Open Government Licence, Canada.",
    "Avis d’appel d’offres et d’attribution d’AchatsCanada : Services publics et Approvisionnement Canada, "
    "Licence du gouvernement ouvert, Canada.",
)
EXPIRING_RIGHTS = (
    "CanadaBuys award notices and contract history: Public Services and Procurement Canada; published contracts: "
    "Treasury Board of Canada Secretariat; Open Government Licence, Canada.",
    "Avis d’attribution et contrats octroyés d’AchatsCanada : Services publics et Approvisionnement Canada; "
    "contrats publiés : Secrétariat du Conseil du Trésor du Canada; Licence du gouvernement ouvert, Canada.",
)
HISTORY_DATASET_URL = "https://open.canada.ca/data/en/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4"
CONTRACT_SEARCH_URL = "https://search.open.canada.ca/contracts/?search_text="
NOTICE_URL = {
    "tenders": "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/",
    "awards": "https://canadabuys.canada.ca/en/tender-opportunities/award-notice/",
}

# French sets a narrow no-break space before a colon, as the site's dictionary does.
FR_COLON = " :"
# Characters XML 1.0 forbids; a title with one would make the whole feed unreadable.
_XML_BAD = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿\ud800-\udfff]")


@dataclass(frozen=True)
class Scope:
    kind: str          # canada | segment | prov | buyer
    key: str           # 'canada', a two-digit segment, a province code, a buyer id
    en: str
    fr: str
    page: str          # the site page the feed mirrors
    named: bool = False  # the index carries the names (buyers)

    @property
    def folder(self) -> str:
        return "canada" if self.kind == "canada" else f"{self.kind}/{self.key.lower()}"


CANADA = Scope("canada", "canada", "Canada", "Canada", "")


@dataclass
class Entry:
    id: str
    updated: str                 # RFC 3339
    title: str
    summary: str
    link: str                    # site path of the notice
    via: str                     # the notice on CanadaBuys
    sort: tuple = ()
    scopes: list[Scope] = field(default_factory=list)


# -- small helpers ------------------------------------------------------------------


def _clean(text: object) -> str:
    return _XML_BAD.sub("", str(text or "")).strip()


def rfc3339(value: str | None) -> str | None:
    """An ISO date or datetime as an RFC 3339 instant in UTC, or None."""
    if not value:
        return None
    text = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return f"{text}T00:00:00Z"
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    dt = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _both(en: str, fr: str) -> str:
    return en if en == fr else f"{en} / {fr}"


def _title(en: object, fr: object, reference: str) -> str:
    # A title is the publisher's text and goes through the same scrub as every exported field.
    en_t, fr_t = _clean(scrub(en, "en")), _clean(scrub(fr, "fr"))
    if en_t and fr_t:
        return _both(en_t, fr_t)
    return en_t or fr_t or reference


def fmt_money(value: float | None, currency: str | None, lang: str) -> str | None:
    if value is None:
        return None
    cur = (currency or "CAD").upper()
    text = f"{value:,.2f}"
    if lang == "fr":
        text = text.replace(",", " ").replace(".", ",")
        return f"{text} $" if cur == "CAD" else f"{text} {cur}"
    return f"${text}" if cur == "CAD" else f"{text} {cur}"


def _day(value: object) -> str | None:
    text = str(value or "")
    return text[:10] if re.match(r"\d{4}-\d{2}-\d{2}", text) else None


def _list(text: object) -> list[str]:
    try:
        value = json.loads(text) if isinstance(text, str) and text else []
    except ValueError:
        return []
    return [str(v) for v in value if v] if isinstance(value, list) else []


def notice_path(reference: str) -> str:
    """A reference as published, in a CanadaBuys notice address.

    CanadaBuys serves a notice at its reference in lower case with the colons
    removed and each "/" kept as a path separator (checked on 2026-11-01:
    SSC-26-00040563:A:1 is at .../award-notice/ssc-26-00040563a1, and
    01044-221065/001/PI at .../award-notice/01044-221065/001/pi); anything
    else that cannot sit in a path is escaped.
    """
    return quote(reference.lower().replace(":", ""), safe="/")


_CLOSING = re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2}|[A-Za-z][A-Za-z ()/_-]*)?")


def closing_text(closing: object, lang: str) -> str | None:
    """A closing value as the site prints it: '2026-11-26 14:00 ET' ('2026-11-26 14 h 00 HE' in French).

    CanadaBuys publishes closing times in Eastern time and its file names no
    zone, so a value without one reads ET; a value with a zone keeps it ("Z"
    reads UTC). A date without a time is the date alone.
    """
    text = str(closing or "").strip()
    m = _CLOSING.match(text)
    if not m:
        return _day(text)
    day, hh, mm, zone = m.groups()
    zone = zone.strip() if zone else ("ET" if lang == "en" else "HE")
    time = f"{hh}:{mm}" if lang == "en" else f"{hh} h {mm}"
    return f"{day} {time} {'UTC' if zone == 'Z' else zone}"


def _segments(codes: object, segments: dict[str, tuple[str, str]]) -> list[str]:
    return sorted({c[:2] for c in str(codes or "").split() if c[:2] in segments})


# -- scopes -------------------------------------------------------------------------


def segment_scope(code: str, segments: dict[str, tuple[str, str]]) -> Scope:
    en, fr = segments[code]
    return Scope("segment", code, f"{code} {en}", f"{code} {fr}", f"/segments/{code}")


def province_scope(code: str) -> Scope:
    en, fr = PROVINCE_NAME[code]
    return Scope("prov", code, en, fr, f"/tenders?province={code}")


def buyer_scope(buyer_id: str, en: str | None, fr: str | None) -> Scope:
    return Scope("buyer", buyer_id, en or buyer_id, fr or en or buyer_id, f"/buyers/{buyer_id}", named=True)


# -- entries ------------------------------------------------------------------------


class _Lookups:
    def __init__(self, conn: sqlite3.Connection) -> None:
        from .export_static import BUYER_ID_RE, read_segments, url_reference

        self.url_reference = url_reference
        self.buyer_ok = BUYER_ID_RE
        self.segments = read_segments()
        self.buyers = {r["id"]: (r["name_en"], r["name_fr"]) for r in conn.execute("SELECT id, name_en, name_fr FROM buyers")}
        self.buyer_scopes: dict[str, Scope] = {}
        self.segment_scopes = {code: segment_scope(code, self.segments) for code in self.segments}
        self.province_scopes = {code: province_scope(code) for code in PROVINCE_NAME}

    def buyer(self, buyer_id: str | None) -> Scope | None:
        if not buyer_id or not self.buyer_ok.match(buyer_id):
            return None
        if buyer_id not in self.buyer_scopes:
            en, fr = self.buyers.get(buyer_id, (None, None))
            self.buyer_scopes[buyer_id] = buyer_scope(buyer_id, en, fr)
        return self.buyer_scopes[buyer_id]

    def buyer_names(self, buyer_id: str | None, raw_en: object, raw_fr: object) -> tuple[str, str]:
        en, fr = self.buyers.get(buyer_id or "", (None, None))
        # A spelling that names or locates a person is never shown.
        en = en or _clean(public_spelling(raw_en))
        return en, fr or _clean(public_spelling(raw_fr)) or en


def _candidates(conn: sqlite3.Connection, sql: str, cutoff: str, max_entries: int) -> list[sqlite3.Row]:
    """The newest max_entries rows, and every row first seen on or after cutoff (the scoped feeds draw on them)."""
    out = []
    for i, r in enumerate(conn.execute(sql)):
        if i >= max_entries and (r["first_sight"] or "") < cutoff:
            break
        out.append(r)
    return out


def tender_entries(conn: sqlite3.Connection, look: _Lookups, cutoff: str, max_entries: int,
                   today: date | None = None) -> list[Entry]:
    """The notices newest first by the night first seen; with today, a notice whose closing day is before it is left out."""
    sql = (
        "SELECT t.reference, t.title_en, t.title_fr, t.published, t.closing, t.buyer_id, t.buyer_raw_en, "
        "t.buyer_raw_fr, t.provinces, t.provinces_derived, "
        "(SELECT MIN(z.first_seen) FROM tenders z WHERE z.reference = t.reference) AS first_sight, "
        "(SELECT group_concat(c.unspsc, ' ') FROM tender_codes c WHERE c.reference = t.reference "
        "AND c.amendment = t.amendment) AS codes "
        "FROM tenders t WHERE t.amendment = (SELECT MAX(y.amendment) FROM tenders y WHERE y.reference = t.reference) "
        "ORDER BY first_sight DESC, t.published DESC, t.reference DESC"
    )
    out: list[Entry] = []
    as_of = today.isoformat() if today else None
    for r in _candidates(conn, sql, cutoff, max_entries):
        ref = look.url_reference(r["reference"])
        stamp = rfc3339(r["first_sight"])
        if ref is None or stamp is None:
            continue
        day = closing_day(r["closing"])
        if as_of and day is not None and day < as_of:
            continue
        b_en, b_fr = look.buyer_names(r["buyer_id"], r["buyer_raw_en"], r["buyer_raw_fr"])
        closing_en, closing_fr = closing_text(r["closing"], "en"), closing_text(r["closing"], "fr")
        en = ". ".join(p for p in (b_en, f"Closing {closing_en}" if closing_en else "", f"Reference {r['reference']}") if p)
        fr = ". ".join(p for p in (b_fr, f"Clôture le {closing_fr}" if closing_fr else "",
                                   f"Référence {r['reference']}") if p)
        scopes = [CANADA]
        scopes += [look.segment_scopes[s] for s in _segments(r["codes"], look.segments)]
        placed = set(_list(r["provinces"])) | set(_list(r["provinces_derived"]))
        scopes += [look.province_scopes[p] for p in sorted(placed) if p in PROVINCE_CODES]
        if b := look.buyer(r["buyer_id"]):
            scopes.append(b)
        out.append(Entry(
            id=f"{TAG}tender/{ref.lower()}", updated=stamp, title=_title(r["title_en"], r["title_fr"], r["reference"]),
            summary=_both(en + ".", fr + "."), link=f"/tenders/{ref.lower()}",
            via=NOTICE_URL["tenders"] + notice_path(r["reference"]),
            sort=(stamp, r["published"] or "", ref), scopes=scopes,
        ))
    return out


def award_entries(conn: sqlite3.Connection, look: _Lookups, cutoff: str, max_entries: int) -> list[Entry]:
    sql = (
        f"WITH newest AS ({organizations._newest_by_reference('awards', ('reference',))}) "
        "SELECT n.reference, n.title_en, n.title_fr, n.published, n.awarded, n.buyer_id, n.buyer_raw_en, "
        "n.buyer_raw_fr, n.supplier_withheld, n.currency, n.status, "
        "CASE WHEN n.supplier_withheld = 1 THEN NULL ELSE o.display_name END AS organization, "
        "CASE WHEN n.status = 'cancelled' THEN 0 WHEN n.total_value > 0 THEN n.total_value ELSE n.amount END AS value, "
        "(SELECT MIN(z.first_seen) FROM awards z WHERE z.reference = n.reference) AS first_sight, "
        "(SELECT group_concat(c.unspsc, ' ') FROM award_codes c WHERE c.reference = n.reference "
        "AND c.amendment = n.amendment) AS codes "
        "FROM newest n LEFT JOIN organizations o ON o.id = n.org "
        "ORDER BY first_sight DESC, n.published DESC, n.reference DESC"
    )
    out: list[Entry] = []
    for r in _candidates(conn, sql, cutoff, max_entries):
        ref = look.url_reference(r["reference"])
        stamp = rfc3339(r["first_sight"])
        if ref is None or stamp is None:
            continue
        b_en, b_fr = look.buyer_names(r["buyer_id"], r["buyer_raw_en"], r["buyer_raw_fr"])
        if r["supplier_withheld"]:
            who_en, who_fr = "Supplier withheld", "Fournisseur non publié"
        elif r["organization"]:
            who_en = who_fr = _clean(r["organization"])
        else:
            who_en, who_fr = "Supplier not named", "Fournisseur non nommé"
        when = _day(r["awarded"])
        en = [f"Awarded to {who_en}" if not r["supplier_withheld"] else who_en]
        fr = [f"Attribué à {who_fr}" if not r["supplier_withheld"] else who_fr]
        if (money := fmt_money(r["value"], r["currency"], "en")) is not None:
            en.append(f"Value {money}")
            fr.append(f"Valeur {fmt_money(r['value'], r['currency'], 'fr')}")
        if when:
            en.append(f"Award date {when}")
            fr.append(f"Date d’attribution {when}")
        en.append(f"Buyer: {b_en}" if b_en else "")
        fr.append(f"Acheteur{FR_COLON} {b_fr}" if b_fr else "")
        scopes = [CANADA]
        scopes += [look.segment_scopes[s] for s in _segments(r["codes"], look.segments)]
        if b := look.buyer(r["buyer_id"]):
            scopes.append(b)
        out.append(Entry(
            id=f"{TAG}award/{ref.lower()}", updated=stamp, title=_title(r["title_en"], r["title_fr"], r["reference"]),
            summary=_both(". ".join(p for p in en if p) + ".", ". ".join(p for p in fr if p) + "."),
            link=f"/awards/{ref.lower()}", via=NOTICE_URL["awards"] + notice_path(r["reference"]),
            sort=(stamp, r["published"] or "", ref), scopes=scopes,
        ))
    return out


def expiring_entries(conn: sqlite3.Connection, look: _Lookups, today: date) -> list[Entry]:
    """The radar's rows inside the 3-month window, each dated by the night it entered (expiring.py).

    An entry's id carries that night, and the text leaves out anything that
    changes daily (the days left), so a row's entry keeps its id and its bytes
    for as long as it stays in the window and a reader sees it once.
    """
    out: list[Entry] = []
    for r in conn.execute("SELECT * FROM expiring_contracts WHERE entered_3m IS NOT NULL AND end >= ? "
                          "ORDER BY entered_3m DESC, end, source_key", (today.isoformat(),)):
        stamp = rfc3339(r["entered_3m"])
        end = _day(r["end"])
        if stamp is None or end is None:
            continue
        kind, published = r["kind"], r["reference"]
        if kind == "contract":
            link = f"/expiring/3m?buyer={r['buyer_id']}" if r["buyer_id"] and look.buyer(r["buyer_id"]) else "/expiring/3m"
            via = CONTRACT_SEARCH_URL + quote(published.split(":", 1)[-1], safe="")
        else:
            ref = look.url_reference(published)
            if ref is None:
                continue
            link = f"/{'awards' if kind == 'award' else 'history'}/{ref.lower()}"
            via = NOTICE_URL["awards"] + notice_path(published) if kind == "award" else HISTORY_DATASET_URL
        if r["supplier_withheld"]:
            who_en, who_fr = "Supplier withheld", "Fournisseur non publié"
        elif r["organization"]:
            who_en = who_fr = _clean(r["organization"])
        else:
            who_en, who_fr = "Supplier not named", "Fournisseur non nommé"
        b_en, b_fr = look.buyer_names(r["buyer_id"], r["buyer_en"], r["buyer_fr"])
        en = [f"Ends on {end}", who_en]
        fr = [f"Se termine le {end}", who_fr]
        if b_en:
            en.append(f"Buyer: {b_en}")
            fr.append(f"Acheteur{FR_COLON} {b_fr}")
        if (money := fmt_money(r["value"], r["currency"], "en")) is not None:
            en.append(f"Value {money}")
            fr.append(f"Valeur {fmt_money(r['value'], r['currency'], 'fr')}")
        scopes = [CANADA]
        scopes += [look.segment_scopes[s] for s in _list(r["segments"]) if s in look.segment_scopes]
        if b := look.buyer(r["buyer_id"]):
            scopes.append(b)
        key = quote(f"{kind}/{published.lower()}", safe="/")
        out.append(Entry(
            id=f"{TAG}expiring/{key}/{r['entered_3m']}", updated=stamp,
            title=_title(r["title_en"], r["title_fr"], published),
            summary=_both(". ".join(en) + ".", ". ".join(fr) + "."), link=link, via=via,
            # Newest night first; within a night, the soonest end first.
            sort=(stamp, -date.fromisoformat(end).toordinal(), r["source_key"]), scopes=scopes,
        ))
    return out


# -- writing ------------------------------------------------------------------------


def _el(parent: ET.Element, tag: str, text: str | None = None, **attrs: str) -> ET.Element:
    el = ET.SubElement(parent, f"{{{ATOM_NS}}}{tag}", {k.rstrip("_"): v for k, v in attrs.items()})
    if text is not None:
        el.text = _clean(text)
    return el


def _page(scope: Scope, event: str) -> str:
    if event == "expiring":
        # The radar's 3-month list, filtered as the site's form filters it.
        if scope.kind == "buyer":
            return f"/expiring/3m?buyer={scope.key}"
        if scope.kind == "segment":
            return f"/expiring/3m?segment={scope.key}"
        return "/expiring"
    if scope.kind == "canada":
        return "/tenders/new" if event == "tenders" else "/awards"
    return scope.page


def page_path(scope: Scope, event: str, n: int) -> str:
    """A feed page's path under the static folder: the first page is the feed's own file."""
    return f"feeds/{scope.folder}/{event}.xml" if n == 1 else f"feeds/{scope.folder}/{event}-{n}.xml"


def feed_pages(entries: list[Entry], max_entries: int = MAX_ENTRIES, max_pages: int = MAX_PAGES) -> list[list[Entry]]:
    """A feed's entries (newest first) in pages: the newest max_entries, then the rest of the newest night's
    entries, max_entries a page, max_pages pages at most. An empty feed is one empty page."""
    first = entries[:max_entries]
    if not first:
        return [[]]
    night = first[0].updated[:10]
    rest = [e for e in entries[max_entries:] if e.updated[:10] == night]
    pages = [first] + [rest[i:i + max_entries] for i in range(0, len(rest), max_entries)]
    return pages[:max_pages]


def feed_document(scope: Scope, event: str, entries: list[Entry], base: str, fallback_updated: str,
                  page: int = 1, pages: int = 1) -> bytes:
    rel = page_path(scope, event, page)
    ev_en, ev_fr = EVENT_NAME[event]
    about_en, about_fr = EVENT_ABOUT[event]
    root = ET.Element(f"{{{ATOM_NS}}}feed")
    _el(root, "id", f"{TAG}feeds/{scope.folder}/{event}")
    _el(root, "title", f"{SITE_NAME}: {ev_en}, {scope.en} / {ev_fr}, {scope.fr}")
    _el(root, "subtitle", _both(about_en, about_fr))
    _el(root, "updated", entries[0].updated if entries else fallback_updated)
    _el(root, "link", rel="self", type="application/atom+xml", href=f"{base}/data/{rel}")
    # RFC 5005 paged feeds: the next page holds the night's older entries.
    if pages > 1:
        _el(root, "link", rel="first", type="application/atom+xml", href=f"{base}/data/{page_path(scope, event, 1)}")
        if page > 1:
            _el(root, "link", rel="previous", type="application/atom+xml", href=f"{base}/data/{page_path(scope, event, page - 1)}")
        if page < pages:
            _el(root, "link", rel="next", type="application/atom+xml", href=f"{base}/data/{page_path(scope, event, page + 1)}")
        _el(root, "link", rel="last", type="application/atom+xml", href=f"{base}/data/{page_path(scope, event, pages)}")
    _el(root, "link", rel="alternate", type="text/html", href=f"{base}{_page(scope, event)}")
    _el(root, "link", rel="related", type="text/html", href=f"{base}/feeds")
    author = _el(root, "author")
    _el(author, "name", SITE_NAME)
    _el(author, "uri", f"{base}/")
    _el(root, "rights", _both(*(EXPIRING_RIGHTS if event == "expiring" else RIGHTS)))
    _el(root, "icon", f"{base}/apple-touch-icon.png")
    for e in entries:
        entry = _el(root, "entry")
        _el(entry, "id", e.id)
        _el(entry, "title", e.title)
        _el(entry, "updated", e.updated)
        sep = "&" if "?" in e.link else "?"
        _el(entry, "link", rel="alternate", type="text/html", hreflang="en", href=f"{base}{e.link}")
        _el(entry, "link", rel="alternate", type="text/html", hreflang="fr", href=f"{base}{e.link}{sep}lang=fr")
        _el(entry, "link", rel="via", href=e.via)
        _el(entry, "summary", e.summary)
    ET.indent(root, space="  ")
    return b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(root, encoding="utf-8", xml_declaration=False) + b"\n"


def _fresh(entries: list[Entry], cutoff: str) -> bool:
    return bool(entries) and entries[0].updated[:10] >= cutoff


def write_feeds(conn: sqlite3.Connection, out: Path, *, today: date | None = None,
                base_url: str | None = None, max_entries: int = MAX_ENTRIES) -> dict[str, int]:
    """Write every feed and feeds/index.json under out; return counts for the export log."""
    base = (base_url or config.SITE_URL).rstrip("/")
    if today is None:
        row = conn.execute("SELECT value FROM meta WHERE key = 'data_as_of'").fetchone()
        as_of = row[0] if row else ""
        today = date.fromisoformat(as_of) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of or "") else datetime.now(timezone.utc).date()
    fallback = f"{today.isoformat()}T00:00:00Z"
    cutoff = (today - timedelta(days=FRESH_DAYS)).isoformat()

    look = _Lookups(conn)
    by_feed: dict[tuple[Scope, str], list[Entry]] = defaultdict(list)
    # A feed keeps its newest max_entries and, past them, the rest of its
    # newest night for the later pages (feed_pages).
    cap = max_entries * MAX_PAGES
    for event, entries in (("tenders", tender_entries(conn, look, cutoff, max_entries, today)),
                           ("awards", award_entries(conn, look, cutoff, max_entries)),
                           ("expiring", expiring_entries(conn, look, today))):
        entries.sort(key=lambda e: e.sort, reverse=True)
        for e in entries:
            for scope in e.scopes:
                bucket = by_feed[(scope, event)]
                if len(bucket) < max_entries or (len(bucket) < cap and e.updated[:10] == bucket[0].updated[:10]):
                    bucket.append(e)
    for event in EVENTS:
        by_feed.setdefault((CANADA, event), [])

    folder = out / "feeds"
    index: list[dict] = []
    written = entries_written = size = 0
    for (scope, event), entries in sorted(by_feed.items(),
                                          key=lambda kv: (SCOPE_ORDER[kv[0][0].kind], kv[0][0].key, EVENTS.index(kv[0][1]))):
        if scope.kind != "canada" and not _fresh(entries, cutoff):
            continue
        pages = feed_pages(entries, max_entries)
        for n, page in enumerate(pages, start=1):
            data = feed_document(scope, event, page, base, fallback, n, len(pages))
            path = out / page_path(scope, event, n)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            written += 1
            entries_written += len(page)
            size += len(data)
        rel = page_path(scope, event, 1)
        item = {"scope": scope.kind, "key": scope.key, "event": event, "path": rel, "entries": len(pages[0]),
                "updated": entries[0].updated[:10] if entries else None}
        if len(pages) > 1:
            item["pages"] = len(pages)
        if scope.named:
            item["name_en"], item["name_fr"] = scope.en, scope.fr
        index.append(item)
    doc = {"as_of": today.isoformat(), "max_entries": max_entries, "fresh_days": FRESH_DAYS, "feeds": index}
    folder.mkdir(parents=True, exist_ok=True)
    data = json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    (folder / "index.json").write_bytes(data)
    return {"feeds": len(index), "feed_files": written, "feed_entries": entries_written, "feed_bytes": size + len(data)}
