"""Where a record's work is delivered: the provinces its source states, and the ones derived from its other fields.

A row's `provinces` are the stated ones: the provinces and territories its
regions of delivery name (normalize.region_provinces). `provinces_derived`
holds the codes read from a field that names a place of delivery without
naming the province, with the field in `provinces_from`:

* "delivery": a city the regions of delivery name ("Esquimalt" gives BC).
  CanadaBuys picks those items from its own location list, which files every
  city under its province or territory; CITIES is that list.
* "opportunity" (tender notices only): the regions of opportunity, read when
  the regions of delivery name nothing at all (empty, or "Unspecified").
* "land_claims" (published contracts only): the Comprehensive Land Claims
  Agreement area the contract is delivered in (LAND_CLAIMS).
* "dcc_office" (tender notices of Defence Construction Canada only): the
  region its regional office's name carries (DCC_OFFICES), read when nothing
  above places the notice. DCC's notices name no region at all, and each of
  its regional offices serves one region; this is the one buyer whose office
  is ever read.

Nothing else is read for a place. The contracting office's address and the
supplier's are where a buyer or a seller sits, not where the work is; the
end-user entity's address is, on nearly every row that gives one, the
department's head office in Ottawa or Gatineau (measured 2026-11-06); a
title or a description is free text. A derived code is never one of the stated codes, so the two
lists never overlap.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3

from .db import get_meta, log_run, set_meta
from .normalize import fold_accents, region_provinces, squash

log = logging.getLogger(__name__)

# Raise it when a table below or the rule changes: the next run derives every
# stored row again (ensure_current).
PLACES_VERSION = 1
META_KEY = "places_version"

FROM_DELIVERY = "delivery"
FROM_OPPORTUNITY = "opportunity"
FROM_LAND_CLAIMS = "land_claims"
FROM_DCC_OFFICE = "dcc_office"

# The cities of CanadaBuys' location list (the Location filter of
# canadabuys.canada.ca/en/tender-opportunities, read 2026-11-06), each under
# the province or territory the list files it under; the National Capital
# Region's two, Ottawa and Gatineau, under Ontario and Quebec. Quebec's
# administrative regions are in the list as places of Quebec too. The files
# write these names as the list does, in both languages. Three names the
# list files under two provinces are left out, because the name alone cannot
# say which: Burlington (NL and ON), Cornwall (ON and PE), Windsor (ON and QC).
CITIES: dict[str, tuple[str, ...]] = {
    "AB": ("Airdrie", "Banff", "Barrhead", "Beaumont", "Beaverlodge", "Bonnyville", "Bowden", "Calgary",
        "Camrose", "Canmore", "Cardston", "Coaldale", "Cochrane", "Cold Lake", "Coronation", "Crossfield", "Devon",
        "Drumheller", "Edmonton", "Fairview", "Fort Saskatchewan", "Fox Creek", "Grand Cache", "Granum", "Hanna",
        "High Level", "Hinton", "Innisfail", "Irricana", "Lacombe", "Leduc", "Lethbridge", "Lloydminster", "Manning",
        "Mayerthorpe", "Medicine Hat", "Morinville", "Oyen", "Peace River", "Penhold", "Pincher Creek", "Ponoka",
        "Provost", "Red Cliff", "Red Deer", "Redwater", "Slave Lake", "Spirit River", "Spruce Grove", "St. Albert",
        "Stettler", "Stony Plain", "Strathmore", "Three Hills", "Tofield", "Valleyview", "Vermilion", "Wainwright",
        "Westlock"),
    "BC": ("Abbotsford", "Agassiz", "Armstrong", "Burnaby", "Chilliwack", "Colwood", "Comox", "Courtenay",
        "Delta", "Esquimalt", "Fraser", "Golden", "Greenwood", "Kamloops", "Kelowna", "Langley", "Maple Ridge",
        "Merrit", "Nanaimo", "Nanoose Bay", "North Vancouver", "Parksville", "Penticton", "Pitt Meadows",
        "Port Alberni", "Prince Rupert", "Princeton", "Revelstoke", "Richmond", "Sidney", "Surrey", "Terrace",
        "Vancouver", "Vernon", "Victoria"),
    "MB": ("Arborg", "Brandon", "Carberry", "Churchill", "Dauphin", "Gimli", "Grand Rapids", "Lynn Lake",
        "Morden", "Portage de la Prairie", "Selkirk", "Steinbach", "Stonewall", "The Pas", "Thompson", "Winnipeg",
        "Winnipeg Beach"),
    "NB": ("Bathurst", "Bouctouche", "Caraquet", "Dieppe", "Fredericton", "Miramichi", "Moncton", "Oromocto",
        "Richibucto", "Rothesay", "Sackville", "Saint Andrews", "Saint John", "Shediac", "Shippagan", "Sussex"),
    "NL": ("Admirals Beach", "Anchor Point", "Arnold's Cove", "Bay Roberts", "Bonavista", "Burgeo", "Burin",
        "Carmanville", "Chance Cove", "Channel-Port aux Basques", "Charlottetown (Labrador)", "Comfort Cove-Newstead",
        "Corner Brook", "Fortune", "Gander", "Garnish", "Glovertown", "Goose Cove East", "Grand Falls-Windsor",
        "Happy Valley-Goose Bay", "Harbour Breton", "Harbour Grace", "La Scie", "Labrador City", "Lark Harbour",
        "Mount Pearl", "Musgrave Harbour", "Paradise", "Port au Choix", "Rocky Harbour", "Salvage", "St. Anthony",
        "St. Bride's", "St. John's", "Stephenville", "Terra Nova", "Trepassey", "Wabush"),
    "NS": ("Bridgewater", "Cape Breton", "Digby", "Halifax", "Kentville", "Middleton", "Pictou",
        "Port Hawkesbury", "Shelburne", "Stellarton", "Trenton", "Truro", "Westville", "Yarmouth"),
    "NT": ("Fort Smith", "Hay River", "Inuvik", "Norman Wells", "YellowKnife"),
    "NU": ("Arctic Bay", "Arviat", "Baker Lake", "Cambridge Bay", "Cape Dorset", "Chesterfield Inlet",
        "Clyde River", "Coral Harbour", "Gjoa Haven", "Grise Fiord", "Iqaluit", "Naujaat (formerly Repulse Bay)",
        "Pangnirtung", "Pond Inlet", "Qikiqtarjuaq", "Rankin Inlet", "Resolute Bay", "Taloyoak", "Whale Cove"),
    "ON": ("Ajax", "Amherstburg", "Bancroft", "Barrie", "Belleville", "Bracebridge", "Brampton", "Brantford",
        "Brockville", "Cambridge", "Carleton Place", "Cobalt", "Cobourg", "Collingwood", "Deep River", "Dryden",
        "Espanola", "Essex", "Fort Erie", "Fort Frances", "Gananoque", "Gore Bay", "Grand Valley", "Gravenhurst",
        "Greater Napanee", "Greater Sudbury", "Guelph", "Hamilton", "Huntsville", "Kapuskasing", "Kawartha Lakes",
        "Kenora", "Kingston", "Kingsville", "Kirkland Lake", "Kitchener", "Latchford", "Laurentian Hills", "London",
        "Marathon", "Markham", "Midland", "Mississauga", "New Tecumseth", "Newmarket", "Niagara Falls",
        "Niagara-on-the-Lake", "North Bay", "Oakville", "Oshawa", "Ottawa", "Owen Sound", "Parry Sound", "Pembroke",
        "Petawawa", "Peterborough", "Pickering", "Point Edward", "Prescott", "Quinte West", "Sarnia",
        "Sault Ste. Marie", "Smiths Falls", "Spanish", "St. Catharines", "Temiskaming Shores", "Thorold",
        "Thunder Bay", "Timmins", "Toronto", "Wasaga Beach", "Waterloo", "Welland", "Whitby"),
    "PE": ("Charlottetown", "North Rustico", "O'Leary", "Souris", "Summerside"),
    "QC": ("Abitibi-Témiscamingue", "Alma", "Baie-Comeau", "Bas-Saint-Laurent", "Beauceville", "Beauharnois",
        "Beaupré", "Bécancour", "Blainville", "Boucherville", "Cap-Santé", "Capitale-Nationale (Québec)",
        "Centre-du-Québec", "Chambly", "Chandler", "Chaudière-Appalaches", "Côte-Nord", "Cowansville",
        "Dollard-Des Ormeaux", "Donnacona", "Dorval", "Drummondville", "Estrie", "Farnham", "Forestville", "Gaspé",
        "Gaspésie–Îles-de-la-Madeleine", "Gatineau", "Granby", "Joliette", "La Malbaie", "Lac-Mégantic", "Lanaudière",
        "Laurentides", "Laval", "Les Îles-de-la-Madeleine", "Lévis", "Longueuil", "Magog", "Maniwaki", "Matagami",
        "Matane", "Mauricie", "Métis-sur-Mer", "Mirabel", "Mont-Joli", "Mont-Laurier", "Mont-Royal", "Mont-Tremblant",
        "Montérégie", "Montmagny", "Montréal", "Montréal-Est", "Montréal-Ouest", "Nicolet", "Nord-du-Québec",
        "Normandin", "Outaouais", "Percé", "Pointe-Claire", "Port-Cartier", "Québec", "Repentigny", "Richelieu",
        "Rimouski", "Rivière-du-Loup", "Rivière-Rouge", "Roberval", "Saguenay", "Saguenay-Lac-Saint-Jean",
        "Saint-Augustin-de-Desmaures", "Saint-Gabriel", "Saint-Georges", "Saint-Hyacinthe",
        "Saint-Jean-sur-Richelieu", "Saint-Jérôme", "Saint-Lazare", "Saint-Ours", "Sainte-Agathe-des-Monts",
        "Sainte-Anne-de-Bellevue", "Sainte-Anne-des-Monts", "Sainte-Anne-des-Plaines", "Sainte-Catherine",
        "Salaberry-de-Valleyfield", "Schefferville", "Sept-Îles", "Shannon", "Shawinigan", "Sherbrooke",
        "Sorel-Tracy", "Témiscaming", "Thetford Mines", "Trois-Rivières", "Varennes", "Vaudreuil-Dorion",
        "Westmount"),
    "SK": ("Broadview", "Carlyle", "Duck Lake", "Dundurn", "Estevan", "Flin Flon", "Fort Qu'Apelle", "Gull Lake",
        "Indian Head", "Kamsack", "Maple Creek", "Melfort", "Melville", "Moose Jaw", "North Battleford", "Outlook",
        "Prince Albert", "Radisson", "Regina", "Saskatoon", "Scott", "Shaunavon", "Swift Current", "Wadena",
        "Weyburn", "Yorkton"),
    "YT": ("Dawson City", "Faro", "Haines Junction", "Teslin", "Watson Lake", "Whitehorse"),
}
# Spellings the files use that the list does not: "Les Îles-de-la-Madeleine"
# reaches the files cut at 23 characters, in both languages.
CITY_SPELLINGS: dict[str, str] = {"Les Îles-de-la-Madelein": "QC"}
# Names the location list files under two provinces; never read as a place.
TWO_PROVINCES = ("Burlington", "Cornwall", "Windsor")
# Items that name no place at all: with only these (or nothing), the regions
# of delivery are read as empty and a tender's regions of opportunity are read.
NO_PLACE = ("Unspecified", "Non spécifiée")

# Defence Construction Canada contracts through regional offices whose names
# carry the region of the work, and its notices leave the regions of delivery
# and of opportunity blank (all 77 open on 2026-11-06). Its office names, as
# the files write them in both language columns (the French column repeats
# the English name), each with the provinces of the region the office serves.
# The head office ("Defence Construction Canada / Construction de Défense
# Canada") and "Defence Construction Canada - Ottawa, ON" name no region and
# give nothing; no Quebec Region office appears in the files. Read only on a
# notice whose buyer is DCC_BUYER_ID: no other buyer's office is ever read.
DCC_BUYER_ID = "dcc-cdc"
DCC_OFFICES: dict[str, tuple[str, ...]] = {
    "Defence Construction Canada - Pacific Region": ("BC",),
    "Defence Construction Canada - Western Region": ("AB", "MB", "SK"),
    "Defence Construction Canada - Ontario Region": ("ON",),
    "Defence Construction Canada - National Capital Region": ("ON", "QC"),
    "Defence Construction Canada - Atlantic Region": ("NB", "NL", "NS", "PE"),
}

# The Comprehensive Land Claims Agreement codes of the published contracts
# (the TBS schema's land_claims choices, open.canada.ca
# recombinant-published-schema/contracts.json), each with the province or
# territory its settlement area lies in. NA (not applicable) gives nothing,
# and so do the two marine regions (EM Eeyou, NI Nunavik), whose waters are
# Nunavut's while the agreements are with peoples of Quebec.
LAND_CLAIMS: dict[str, tuple[str, ...]] = {
    "NU": ("NU",),                          # Nunavut Agreement
    "JN": ("QC",),                          # James Bay and Northern Quebec Agreement
    "NQ": ("QC",),                          # Northeastern Quebec Agreement
    "LI": ("NL",),                          # Labrador Inuit Land Claim Agreement
    "IF": ("NT", "YT"),                     # Inuvialuit Final Agreement (the settlement region spans both)
    "GW": ("NT",),                          # Gwich'in Comprehensive Land Claim Agreement
    "SD": ("NT",),                          # Sahtu Dene and Metis Comprehensive Land Claim Agreement
    "TA": ("NT",),                          # Tlicho Agreement
    "MF": ("BC",),                          # Maa-nulth First Nations Final Agreement
    "NF": ("BC",),                          # Nisga'a Final Agreement
    "TF": ("BC",),                          # Tsawwassen First Nation Final Agreement
    "TL": ("BC",),                          # Tla'amin Final Agreement
    "YA": ("BC",),                          # Yale First Nations Final Agreement
    # The Yukon First Nations' final agreements.
    "CH": ("YT",), "CT": ("YT",), "FN": ("YT",), "KD": ("YT",), "KF": ("YT",), "LS": ("YT",),
    "SF": ("YT",), "TH": ("YT",), "TK": ("YT",), "TT": ("YT",), "VG": ("YT",),
}


def _key(text: object) -> str:
    return fold_accents(squash(str(text or "").lstrip("*")).casefold())


_CITY_KEYS: dict[str, str] = {
    **{_key(name): code for code, names in CITIES.items() for name in names},
    **{_key(name): code for name, code in CITY_SPELLINGS.items()},
}
_NO_PLACE_KEYS = {_key(x) for x in NO_PLACE}


def city_provinces(items: list[str]) -> list[str]:
    """The provinces of the cities a list of regions names, sorted and without repeats. A name the location
    list does not hold, or holds under two provinces, gives nothing."""
    return sorted({code for item in items or [] if (code := _CITY_KEYS.get(_key(item)))})


def names_no_place(items: list[str]) -> bool:
    """Whether a list of regions is empty or says only that the region is unspecified."""
    return all(_key(item) in _NO_PLACE_KEYS for item in items or [] if _key(item))


def dcc_office_provinces(buyer_id: str | None, *names: object) -> list[str]:
    """The provinces of the region a Defence Construction Canada office's name carries; nothing for any other
    buyer, and nothing for a name DCC_OFFICES does not hold exactly."""
    if buyer_id != DCC_BUYER_ID:
        return []
    for name in names:
        codes = DCC_OFFICES.get(squash(name))
        if codes:
            return sorted(codes)
    return []


def derive(delivery: list[str], opportunity: list[str] | None = None,
           office: list[str] | None = None) -> tuple[list[str], list[str], str | None]:
    """(stated, derived, the field derived from) for a row's regions of delivery (both languages together) and,
    for a tender notice, its regions of opportunity and the provinces of its DCC office (dcc_office_provinces);
    derived is empty and the field None when nothing adds a code."""
    stated = region_provinces(delivery)
    from_cities = [c for c in city_provinces(delivery) if c not in stated]
    if from_cities:
        return stated, from_cities, FROM_DELIVERY
    if opportunity and names_no_place(delivery):
        found = sorted(set(region_provinces(opportunity)) | set(city_provinces(opportunity)))
        if found:
            return stated, found, FROM_OPPORTUNITY
    # The office last, and only where the notice names no region of delivery:
    # one that states "Canada" keeps it.
    if office and names_no_place(delivery):
        return stated, sorted(office), FROM_DCC_OFFICE
    return stated, [], None


def land_claim_provinces(raw: object) -> list[str]:
    """The provinces of the land claims agreement areas a published contract names ('NU', 'NU,IF')."""
    # Codes only, two letters each between separators: a word that merely starts with one is not a code.
    codes = [c for c in re.split(r"[^A-Za-z]+", str(raw or "")) if len(c) == 2]
    return sorted({p for c in codes for p in LAND_CLAIMS.get(c.upper(), ())})


def _json(items: list[str]) -> str | None:
    return json.dumps(items) if items else None


def fields(delivery: list[str], opportunity: list[str] | None = None,
           office: list[str] | None = None) -> dict[str, str | None]:
    """The three columns a CanadaBuys row stores: provinces, provinces_derived (JSON lists) and provinces_from."""
    stated, derived, source = derive(delivery, opportunity, office)
    return {"provinces": _json(stated), "provinces_derived": _json(derived), "provinces_from": source}


def _list(text: object) -> list[str]:
    try:
        items = json.loads(text) if isinstance(text, str) and text else []
    except ValueError:
        return []
    return [str(x) for x in items] if isinstance(items, list) else []


# The tables whose rows carry regions, the columns each derivation reads, and
# whether the DCC office is read (tender notices: DCC publishes no award).
TABLES = (
    ("tenders", ("regions_delivery_en", "regions_delivery_fr"), ("regions_opportunity_en", "regions_opportunity_fr"),
     True),
    ("awards", ("regions_delivery_en", "regions_delivery_fr"), (), False),
    ("contract_history", ("regions_delivery_en", "regions_delivery_fr"), (), False),
)
_OFFICE_COLUMNS = ("buyer_id", "buyer_raw_en", "buyer_raw_fr")


def sweep(conn: sqlite3.Connection) -> dict[str, int]:
    """Derive every stored row of tenders, awards and contract_history again from its stored regions, writing
    the rows whose three columns change; returns the rows changed and the rows with a derived code, by table.

    The loaders set the columns on each version they read; this brings the
    versions no file will be read for again (the legacy files are read once)
    under the current rule.
    """
    counts: dict[str, int] = {}
    for table, delivery, opportunity, offices in TABLES:
        cols = ", ".join(("reference", "amendment", "provinces", "provinces_derived", "provinces_from") + delivery
                         + opportunity + (_OFFICE_COLUMNS if offices else ()))
        changes = []
        derived = 0
        for r in conn.execute(f"SELECT {cols} FROM {table}"):
            regions = [x for c in delivery for x in _list(r[c])]
            opp = [x for c in opportunity for x in _list(r[c])] if opportunity else None
            office = dcc_office_provinces(r["buyer_id"], r["buyer_raw_en"], r["buyer_raw_fr"]) if offices else None
            want = fields(regions, opp, office)
            if want["provinces_derived"]:
                derived += 1
            if (r["provinces"], r["provinces_derived"], r["provinces_from"]) != (
                    want["provinces"], want["provinces_derived"], want["provinces_from"]):
                changes.append((want["provinces"], want["provinces_derived"], want["provinces_from"], r["reference"],
                                r["amendment"]))
        conn.executemany(f"UPDATE {table} SET provinces = ?, provinces_derived = ?, provinces_from = ? "
                         "WHERE reference = ? AND amendment = ?", changes)
        counts[f"{table}_changed"] = len(changes)
        counts[f"{table}_derived"] = derived
    return counts


def ensure_current(conn: sqlite3.Connection) -> dict[str, int] | None:
    """Run sweep once when meta.places_version differs from PLACES_VERSION, in one transaction; None when current."""
    have = get_meta(conn, META_KEY)
    if have == str(PLACES_VERSION):
        return None
    try:
        counts = sweep(conn)
        set_meta(conn, META_KEY, PLACES_VERSION)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    log.info("places: version %s -> %s: %s", have, PLACES_VERSION, counts)
    changed = sum(v for k, v in counts.items() if k.endswith("_changed"))
    if changed:
        # The run log records a sweep that changed rows; a new or empty database only gets its version.
        detail = f"places_version {have} -> {PLACES_VERSION}: " + " ".join(f"{k}={v}" for k, v in counts.items())
        log_run(conn, "places", detail=detail, rows_in=changed)
    return counts
