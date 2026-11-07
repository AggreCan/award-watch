"""Standing offers and supply arrangements as the site shows them: the static files and the records rows.

The static export (export_static) writes, from the sosa tables (sources/sosa.py):

  instruments/index.json   every instrument with an active holder, for /instruments and its filters and CSV:
                           the file's publication date, the stage's outcome (ok, held, failed, none), the
                           names of the types, commodity codes, end users and delivery points once each, and
                           one row per instrument (number, type code and, for a type the stage does not know,
                           the file's words, description cut at DESCRIPTION_CHARS, commodity codes, end user,
                           regions, segments, start, expiry, holders, persons withheld)
  profiles/<abc>.json      "instruments" on a profile whose organization holds one: the active ones with
                           the organization's regions and the expiry, soonest first, and the ones it no
                           longer holds (lost within sosa.LOST_KEEP_DAYS) under "lapsed"
  categories/<nn>.json     "holders": the HOLDERS_TOP organizations with the most active instruments
                           carrying the segment, each with the count and the soonest expiry
  buyers/<id>.json         "holders": the same over the instruments whose end user is the buyer
  tenders/<abc>.json       "instruments" on a notice whose solicitation stem matches active instruments:
                           each one's number, holders and expiry

The records database (records_db) holds rec_instruments and rec_holders,
which the instrument page (/instruments/<agreement>) and its CSV of holders
read. A holder withheld as a person has no row there, and its count is the
instrument's nw: nothing that names or locates the person leaves the
pipeline database.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Iterator
from datetime import date
from urllib.parse import quote

from .db import get_meta
from .normalize import slugify
from .sources import sosa

DESCRIPTION_CHARS = 120
# The commodity names of one instrument on the records row: "code - name" pieces, "; " between them.
COMMODITY_CHARS = 2000
# The longest agreement number the site's address takes (site/src/instruments.ts AGREEMENT_MAX).
AGREEMENT_MAX = 120
HOLDERS_TOP = 25
# The profile lists every instrument held; a firm holds dozens at most, and
# this bound only stops a runaway file.
PROFILE_MAX = 500
# Where a reader goes for the government's own record.
SEARCH_URL = "https://sosa.canadabuys.canada.ca/"


def instrument_path(agreement: str) -> str:
    """/instruments/<the agreement number as one escaped path segment> (E60ZT-120002%2F001%2FZT)."""
    return "/instruments/" + quote(agreement, safe="")


def addressable(agreement: object) -> bool:
    """A number the site can serve a page for: one the index lists and the sitemap names."""
    return isinstance(agreement, str) and 0 < len(agreement) <= AGREEMENT_MAX and not re.search(r"[\x00-\x1f\x7f]", agreement)


def short(value: object, limit: int = DESCRIPTION_CHARS) -> str | None:
    """One line, cut at a word within limit characters with an ellipsis (records_db.title_of's rule)."""
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text or None
    cut = text[:limit - 1]
    space = cut.rfind(" ")
    return (cut[:space] if space > limit // 2 else cut).rstrip(" ,;:.") + "…"


def end_user_key(buyer_id: str | None, en: str | None, fr: str | None) -> str | None:
    """The end user's filter value: the buyer id when a buyer is known, else n: and a slug of its name."""
    if buyer_id:
        return buyer_id
    slug = slugify(en or fr or "")
    return f"n:{slug[:60]}" if slug else None


def _regions(conn: sqlite3.Connection) -> dict[str, list[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for a, region in conn.execute("SELECT agreement_number, delivery_point_code FROM sosa_holders WHERE lost_on IS NULL"):
        if region:
            out[a].add(region)
    return {a: sorted(r) for a, r in out.items()}


def _gsin_names(conn: sqlite3.Connection) -> dict[str, tuple[str | None, str | None]]:
    return {r[0]: (r[1], r[2]) for r in conn.execute("SELECT code, desc_en, desc_fr FROM gsin_codes")}


def commodity_parts(r: sqlite3.Row, gsin: dict[str, tuple[str | None, str | None]]) -> tuple[list[str], dict, dict]:
    """An instrument's commodity codes and each one's English and French names: from the file's descriptions
    ("code - name" pieces), else the GSIN table's. Read from the stored text, so a value stored before the
    stage cleaned it (in the file's quotes, a list cut at 40 characters) reads clean until the next file."""
    codes = sosa.commodity_codes(r["commodity"])
    en = sosa.commodity_names(codes, r["commodity_en"])
    fr = sosa.commodity_names(codes, r["commodity_fr"])
    for code in codes:
        if code not in en and code not in fr and code in gsin:
            e, f = gsin[code]
            if e:
                en[code] = e
            if f:
                fr[code] = f
    return codes, en, fr


def _region_names(conn: sqlite3.Connection) -> dict[str, dict]:
    """Each delivery point code's names as the file writes them, the most frequent spelling, for the codes the
    site has no name of its own for (a country, the file's own codes for the whole country and the capital)."""
    seen: dict[str, Counter] = defaultdict(Counter)
    for code, en, fr in conn.execute("SELECT delivery_point_code, delivery_point_en, delivery_point_fr FROM sosa_holders "
                                     "WHERE lost_on IS NULL"):
        en, fr = sosa.unquote(en) or None, sosa.unquote(fr) or None
        if code and (en or fr):
            seen[code][(en or "", fr or "")] += 1
    out = {}
    for code, spellings in sorted(seen.items()):
        (en, fr), _ = min(spellings.items(), key=lambda kv: (-kv[1], kv[0]))
        out[code] = {"en": short(en or None, 200), "fr": short(fr or None, 200)}
    return out


def index_doc(conn: sqlite3.Connection, as_of: str) -> dict:
    """instruments/index.json."""
    regions = _regions(conn)
    gsin = _gsin_names(conn)
    types: dict[str, dict] = {}
    commodities: dict[str, dict] = {}
    users: dict[str, dict] = {}
    rows = []
    for r in sosa.active_instruments(conn):
        if not addressable(r["agreement_number"]):
            continue
        code = sosa.type_code(r["type_en"])
        type_en, type_fr = sosa.type_names(r["type_en"], r["type_fr"])
        # One name per known type. The types the stage does not know share the code OTHER, so each such row
        # carries its own words rather than one of them standing for all (every row read "NISO" that way).
        if code != "OTHER":
            types.setdefault(code, {"en": type_en, "fr": type_fr})
        codes, names_en, names_fr = commodity_parts(r, gsin)
        for c in codes:
            named = commodities.setdefault(c, {"en": None, "fr": None})
            named["en"] = named["en"] or short(names_en.get(c), 200)
            named["fr"] = named["fr"] or short(names_fr.get(c), 200)
        user = end_user_key(r["end_user_buyer_id"], r["end_user_en"], r["end_user_fr"])
        if user and user not in users:
            users[user] = {"en": short(r["end_user_en"], 200), "fr": short(r["end_user_fr"], 200),
                           "buyer_id": r["end_user_buyer_id"]}
        row = {
            "agreement": r["agreement_number"], "type": code,
            "description_en": short(r["description_en"]), "description_fr": short(r["description_fr"]),
            "commodity": codes, "end_user": user, "regions": regions.get(r["agreement_number"], []),
            "segments": sosa.segments_of(r["segments"]), "start": r["start"], "expiry": r["expiry"],
            "n_holders": r["n_holders"], "n_holders_withheld": r["n_holders_withheld"],
        }
        if code == "OTHER":
            row["type_en"], row["type_fr"] = short(type_en, 200), short(type_fr, 200)
        rows.append(row)
    return {
        "as_of": as_of, "published": get_meta(conn, sosa.META_PUBLISHED), "status": sosa.stage_outcome(conn),
        "source": SEARCH_URL, "types": types, "commodities": commodities, "end_users": users,
        "region_names": _region_names(conn), "rows": rows,
    }


def organization_parts(conn: sqlite3.Connection) -> dict[str, dict]:
    """profiles' "instruments": per organization, the instruments it holds and the ones it lapsed from."""
    active: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    lapsed: dict[str, dict[str, tuple[set[str], str, str | None]]] = defaultdict(dict)
    for a, oid, region, lost_on, why in conn.execute(
            "SELECT agreement_number, organization_id, delivery_point_code, lost_on, lost_why FROM sosa_holders "
            "WHERE organization_id IS NOT NULL ORDER BY agreement_number, delivery_point_code"):
        if lost_on is None:
            active[oid][a].add(region)
        else:
            regions, last, w = lapsed[oid].get(a, (set(), "", None))
            regions.add(region)
            lapsed[oid][a] = (regions, max(last, lost_on), why or w)
    info = {r["agreement_number"]: r for r in conn.execute("SELECT * FROM sosa_instruments")}

    def row(a: str, regions: set[str]) -> dict:
        r = info[a]
        type_en, type_fr = sosa.type_names(r["type_en"], r["type_fr"])
        return {"agreement": a, "type": sosa.type_code(r["type_en"]), "type_en": type_en, "type_fr": type_fr,
                "description_en": short(r["description_en"]), "description_fr": short(r["description_fr"]),
                "regions": sorted(x for x in regions if x), "expiry": r["expiry"]}

    out: dict[str, dict] = {}
    for oid in sorted(set(active) | set(lapsed)):
        held = [row(a, regions) for a, regions in active.get(oid, {}).items() if a in info]
        held.sort(key=lambda x: (x["expiry"] is None, x["expiry"] or "", x["agreement"]))
        gone = []
        for a, (regions, lost_on, why) in lapsed.get(oid, {}).items():
            if a in info and a not in active.get(oid, {}):
                gone.append({**row(a, regions), "lost_on": lost_on, "why": why})
        gone.sort(key=lambda x: (x["lost_on"], x["agreement"]), reverse=True)
        out[oid] = {"n": len(held), "rows": held[:PROFILE_MAX], "lapsed": gone[:PROFILE_MAX]}
    return out


def _holder_tops(conn: sqlite3.Connection, keys_of) -> dict[str, dict]:
    """Per key (a segment or a buyer): the organizations with the most active instruments, then the soonest expiry."""
    names = {r[0]: r[1] for r in conn.execute("SELECT id, display_name FROM organizations")}
    cells: dict[str, dict[str, list]] = defaultdict(dict)
    for r in conn.execute(
            "SELECT DISTINCT h.organization_id AS oid, i.agreement_number AS a, i.expiry AS expiry, i.segments AS segments, "
            "i.end_user_buyer_id AS buyer FROM sosa_holders h JOIN sosa_instruments i ON i.agreement_number = h.agreement_number "
            "WHERE h.lost_on IS NULL AND h.organization_id IS NOT NULL"):
        if r["oid"] not in names:
            continue
        for key in keys_of(r):
            cell = cells[key].setdefault(r["oid"], [0, None])
            cell[0] += 1
            if r["expiry"] and (cell[1] is None or r["expiry"] < cell[1]):
                cell[1] = r["expiry"]
    out = {}
    for key, orgs in cells.items():
        ranked = sorted(orgs.items(), key=lambda kv: (-kv[1][0], kv[1][1] is None, kv[1][1] or "", kv[0]))
        out[key] = {"n": len(orgs), "rows": [{"id": oid, "name": names[oid], "n": n, "soonest": soonest}
                                             for oid, (n, soonest) in ranked[:HOLDERS_TOP]]}
    return out


def segment_holders(conn: sqlite3.Connection) -> dict[str, dict]:
    return _holder_tops(conn, lambda r: sosa.segments_of(r["segments"]))


def buyer_holders(conn: sqlite3.Connection) -> dict[str, dict]:
    return _holder_tops(conn, lambda r: [r["buyer"]] if r["buyer"] else [])


def tender_instruments(conn: sqlite3.Connection) -> dict[str, list[dict]]:
    """The active instruments under each solicitation stem, for the notices that carry it."""
    out: dict[str, list[dict]] = defaultdict(list)
    for r in sosa.active_instruments(conn):
        s = r["solicitation"] or sosa.stem(r["agreement_number"])
        if s:
            out[s].append({"agreement": r["agreement_number"], "n_holders": r["n_holders"],
                           "n_holders_withheld": r["n_holders_withheld"], "expiry": r["expiry"]})
    return out


def sitemap_entries(conn: sqlite3.Connection, as_of: str) -> list[tuple[str, str | None]]:
    """/instruments and each active instrument's page, dated by the file that last held it."""
    entries: list[tuple[str, str | None]] = [("/instruments", as_of)]
    entries += [(instrument_path(r["agreement_number"]), r["last_seen"]) for r in sosa.active_instruments(conn)
                if addressable(r["agreement_number"])]
    return entries


# -- the records database (rec_instruments, rec_holders) --------------------------------


def instrument_rows(conn: sqlite3.Connection, key_of, org_number, tender_url) -> Iterator[tuple]:
    """Every instrument in the pipeline database (active, or kept after its last holder lapsed), as
    records_db.INSTRUMENTS writes it. calls is the call-ups as JSON: [organization number or null for any other
    vendor, rows, cents or null, rows with no value], the largest first."""
    calls: dict[str, list] = defaultdict(list)
    for a, oid, n, value, nv in conn.execute("SELECT agreement_number, organization_id, n, value, n_no_value FROM sosa_callups"):
        cents = None if value is None else int(round(value * 100))
        calls[a].append([org_number(oid) if oid else None, n, cents, nv])
    gsin = _gsin_names(conn)
    for r in conn.execute("SELECT * FROM sosa_instruments ORDER BY agreement_number"):
        a = r["agreement_number"]
        segs = sosa.segments_of(r["segments"])
        codes, names_en, names_fr = commodity_parts(r, gsin)
        # gsin holds the codes and gsin_en and gsin_fr their names as "code - name" pieces, which the page reads
        # back one code at a time (site/src/instruments.ts commodityList).
        en = "; ".join(f"{c} - {names_en[c]}" for c in codes if c in names_en)
        fr = "; ".join(f"{c} - {names_fr[c]}" for c in codes if c in names_fr)
        type_en, type_fr = sosa.type_names(r["type_en"], r["type_fr"])
        mine = sorted(calls.get(a, []), key=lambda c: (-(c[2] or 0), -c[1], c[0] is None, c[0] or 0))
        yield (
            key_of(f"sosa:{a}"), a, short(type_en, 200), short(type_fr, 200), short(r["description_en"]),
            short(r["description_fr"]), "; ".join(codes) or None, short(en, COMMODITY_CHARS), short(fr, COMMODITY_CHARS),
            short(r["end_user_en"], 200),
            short(r["end_user_fr"], 200), r["end_user_buyer_id"], r["start"], r["expiry"],
            f" {' '.join(segs)} " if segs else "", tender_url(r["tender_reference"]) if r["tender_reference"] else None,
            r["n_holders"], r["n_holders_withheld"], r["first_seen"], r["last_seen"],
            json.dumps(mine, separators=(",", ":")) if mine else None,
        )


def holder_rows(conn: sqlite3.Connection, key_of, org_number) -> Iterator[tuple]:
    """Every active holder row whose name is shown, as records_db.HOLDERS writes it."""
    for r in conn.execute("SELECT * FROM sosa_holders WHERE lost_on IS NULL AND supplier_withheld = 0 "
                          "AND supplier_raw IS NOT NULL ORDER BY agreement_number, supplier_norm, delivery_point_code"):
        a = r["agreement_number"]
        name = short(r["supplier_raw"], 300)
        if not name:
            continue
        yield (
            key_of(f"sosa:{a}:{r['supplier_norm']}:{r['delivery_point_code']}"), key_of(f"sosa:{a}"),
            org_number(r["organization_id"]), name, short(r["operating_name"], 300),
            r["delivery_point_code"], short(r["delivery_point_en"], 200), short(r["delivery_point_fr"], 200), r["first_seen"],
        )


def days_left(expiry: str | None, as_of: str) -> int | None:
    try:
        return (date.fromisoformat(expiry or "") - date.fromisoformat(as_of)).days
    except ValueError:
        return None
