"""The indigenous_target stage (sources/indigenous_target.py): the three files of Indigenous Services Canada's
mandatory minimum 5% Indigenous procurement target as published, every header layout of 2022-23 to 2025-26, the
no-data words, the institutions resolved to buyers, the datasets found through the catalogue search or the known
ids, the stage's failures as notices, and the block the export writes.

The fixtures are cuts of the real files (Open Government Licence - Canada; docs/indigenous-procurement.md names
each source): indigenous_target_plan.csv, _gaps.csv and _results.csv are the header and the rows of eight
institutions of the 2025-26 plan's two files and of the 2024-25 results, as published (a byte-order mark,
UTF-8), with the line ends made LF; indigenous_target_gaps_2024.csv is three rows of the previous plan's gaps
file, as published in Windows-1252."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, config, export_static
from awardwatch_pipeline.db import set_meta
from awardwatch_pipeline.sources import buyers, contracts
from awardwatch_pipeline.sources import indigenous_target as ipt
from conftest import FakeResponse

STAMP = "2026-11-14T03:00:00Z"
PLAN_DS = "88bd5306-e0a1-46dd-8e02-909931ade592"
OLD_PLAN_DS = "440a10df-4f65-47f4-851c-6acf30d37841"
RESULTS_DS = "65dfa39f-e699-4698-b8c7-29e1b99d7b23"
BASE = "https://open.canada.ca/data/dataset/"
# The plan's two files of 2025-26 have one file name: only the resource id tells them apart.
SHARED = "edma-dfm-data-management-open-data-2025-2026-dr001038-5-indigenous-procurement-target-planning-d.csv"
PLAN_URL = f"{BASE}{PLAN_DS}/resource/2c4492e4-d555-4ba4-9222-575aec94011e/download/{SHARED}"
GAPS_URL = f"{BASE}{PLAN_DS}/resource/a8b56549-c3d1-47f4-9fd7-11931b0933d9/download/{SHARED}"
RESULTS_URL = f"{BASE}{RESULTS_DS}/resource/03cb0d81-fe7a-45bf-b933-f7a78bdf2ef2/download/03cb0d81-fe7a-45bf-b933-f7a78bdf2ef2-1.csv"
SEARCH = ipt.search_url()
# The publisher's titles part the years from the target's name with an en dash, kept as published.
TITLE_DASH = chr(0x2013)
SHOW = config.CKAN_PACKAGE_SHOW
CKAN_BUYERS = {
    "pwgsc-tpsgc": ("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada", "PSPC", "SPAC"),
    "hc-sc": ("Health Canada", "Santé Canada", "HC", "SC"),
    "fednor": ("Federal Economic Development Agency for Northern Ontario",
               "Agence fédérale de développement économique pour le Nord de l'Ontario", "FedNor", "FedNor"),
    "isc-sac": ("Indigenous Services Canada", "Services aux Autochtones Canada", "ISC", "SAC"),
    "casdo-ocena": ("Accessibility Standards Canada", "Normes d'accessibilité Canada", "ASC", "NAC"),
    "npa-apn": ("Northern Pipeline Agency Canada", "Administration du pipe-line du Nord Canada", "NPA", "APN"),
    "atssc-scdata": ("Administrative Tribunals Support Service of Canada", "Service canadien d'appui aux tribunaux administratifs",
                     "ATSSC", "SCDATA"),
}


def fixture(fixtures: Path, part: str) -> bytes:
    return (fixtures / f"indigenous_target_{part}.csv").read_bytes()


def write(path: Path, data: bytes) -> Path:
    path.write_bytes(data)
    return path


@pytest.fixture
def world(conn):
    """The CKAN organizations the fixtures' institutions are, and the seed (the Northern Pipeline Agency's row)."""
    for bid, (en, fr, a_en, a_fr) in CKAN_BUYERS.items():
        buyers.upsert_ckan(conn, {"name": bid, "title_translated": {"en": en, "fr": fr}, "shortform": {"en": a_en, "fr": a_fr}},
                           now=STAMP)
    buyers.load_seed(conn, buyers.read_seed(), now=STAMP)
    conn.commit()
    return set(CKAN_BUYERS)


def resource(part: str, dataset: str = PLAN_DS, fy: int = 2025, last: int = 2026, found: str = "search") -> ipt.Resource:
    url = {ipt.PLAN: PLAN_URL, ipt.GAPS: GAPS_URL, ipt.RESULTS: RESULTS_URL}[part]
    if part == ipt.RESULTS:
        dataset, fy, last = RESULTS_DS, 2024, 2024
    return ipt.Resource(part, dataset, fy, last, f"res-{part}", url, None, None, "2026-04-07T12:23:10", found)


def load(conn, fixtures, tmp_path, part: str, data: bytes | None = None):
    path = write(tmp_path / f"{part}.csv", data if data is not None else fixture(fixtures, part))
    res = resource(part)
    parsed = ipt.read_file(path, part, res.years)
    linked = ipt.apply(conn, parsed, res, digest=contracts.sha256(path), etag='"e1"', last_modified="Tue, 07 Apr 2026 12:23:10 GMT",
                       stamp=STAMP)
    return parsed, linked


def load_all(conn, fixtures, tmp_path):
    for part in ipt.PARTS:
        _, linked = load(conn, fixtures, tmp_path, part)
    return linked


def rows(conn, table: str, **where) -> list:
    sql = f"SELECT * FROM {table}" + (" WHERE " + " AND ".join(f"{k} = ?" for k in where) if where else "") + " ORDER BY seq"
    return conn.execute(sql, tuple(where.values())).fetchall()


def log_row(conn):
    return conn.execute("SELECT * FROM sources_log WHERE source = 'indigenous_target' ORDER BY id DESC").fetchone()


# -- the dataset records, cut from the real ones ----------------------------------------------------------------


def res_entry(rid: str, url: str, en: str, fr: str, fmt: str = "CSV", kind: str = "dataset", modified: str = "2026-04-07T12:23:10") -> dict:
    return {"id": rid, "url": url, "format": fmt, "resource_type": kind, "last_modified": modified,
            "name_translated": {"en": en, "fr": fr}}


def plan_record(dataset: str = PLAN_DS, years: str = "2025-2026 and 2026-2027", licence: str = "ca-ogl-lgo",
                plan_url: str = PLAN_URL, gaps_url: str = GAPS_URL, modified: str = "2026-04-07T12:23:10", gaps: bool = True) -> dict:
    resources = [
        res_entry("ff1220e6", f"{BASE}{dataset}/resource/ff1220e6/download/summary.csv", "2025-26 and 2026-27 Planning Report Summary",
                  "Sommaire du rapport de planification 2025-2026 et 2026-2027"),
        res_entry(plan_url.split("/resource/")[1].split("/")[0], plan_url, "2025-26 and 2026-27 Planned Procurement",
                  "Approvisionnements planifiés 2025-2026 et 2026-2027", modified=modified),
        res_entry("6fd8c3d1", f"{BASE}{dataset}/resource/6fd8c3d1/download/dictionary.xlsx",
                  "2025-26 and 2026-27 Planned Procurement - Data Dictionary", "Approvisionnements planifiés - Dictionnaire de données",
                  fmt="XLSX", kind="data_dictionary"),
    ]
    if gaps:
        resources.append(res_entry(gaps_url.split("/resource/")[1].split("/")[0], gaps_url, "2025-26 and 2026-27 Gaps in Indigenous Procurement",
                                   "Lacunes dans l'approvisionnement autochtone 2025-2026 et 2026-2027", modified=modified))
    return {"id": dataset, "license_id": licence, "organization": {"name": "isc-sac"}, "metadata_created": "2025-09-05T18:11:07",
            "title_translated": {"en": f"{years} Planned Procurement {TITLE_DASH} Mandatory Minimum 5% Indigenous Procurement Target",
                                 "fr": f"{years.replace(' and ', ' et ')} Approvisionnements planifiés"},
            "resources": resources}


def results_record(dataset: str = RESULTS_DS, fy: str = "2024-2025", url: str = RESULTS_URL) -> dict:
    return {"id": dataset, "license_id": "ca-ogl-lgo", "organization": {"name": "isc-sac"}, "metadata_created": "2026-03-25T16:03:56",
            "title_translated": {"en": f"Results of the Mandatory Minimum 5% Indigenous Procurement Target for Fiscal Year {fy}",
                                 "fr": f"Résultats pour l'exercice {fy}"},
            "resources": [
                res_entry("22409e8f", "https://www.sac-isc.gc.ca/eng/1691786841904/1691786863431", "Mandatory minimum 5% Indigenous "
                          "procurement target", "Cible", fmt="HTML", kind="website"),
                res_entry(url.split("/resource/")[1].split("/")[0], url, f"Results of the Mandatory Minimum 5% Indigenous Procurement "
                          f"Target for Fiscal Year {fy}", "Résultats", modified="2026-04-07T12:30:46"),
                res_entry("79a8571c", f"{BASE}{dataset}/resource/79a8571c/download/details.csv", "Contract Details of the Mandatory "
                          f"Minimum 5% Indigenous Procurement Target for Fiscal Year {fy}", "Détails sur les contrats"),
            ]}


def relative(record: dict) -> dict:
    """A record as the search gives it: an uploaded file's address from the catalogue's root, read 2026-11-14
    ("/data/dataset/<id>/resource/<id>/download/<file>"), where the record itself gives it whole."""
    out = json.loads(json.dumps(record))
    for res in out["resources"]:
        if res["url"].startswith("https://open.canada.ca/"):
            res["url"] = res["url"][len("https://open.canada.ca"):]
    return out


def search(*records: dict) -> bytes:
    return json.dumps({"success": True, "result": {"count": len(records), "results": [relative(r) for r in records]}}).encode()


def show(record: dict) -> bytes:
    return json.dumps({"success": True, "result": record}).encode()


def client_for(fake_client, fixtures, **extra):
    mapping = {
        SEARCH: search(plan_record(), results_record(),
                       plan_record(OLD_PLAN_DS, "2024-2025 and 2025-2026", plan_url=f"{BASE}{OLD_PLAN_DS}/resource/5b73/download/p.csv",
                                   gaps_url=f"{BASE}{OLD_PLAN_DS}/resource/626a/download/g.csv")),
        PLAN_URL: FakeResponse(200, fixture(fixtures, "plan"), {"ETag": '"p1"', "Last-Modified": "Tue, 07 Apr 2026 12:23:10 GMT"}),
        GAPS_URL: FakeResponse(200, fixture(fixtures, "gaps"), {"ETag": '"g1"', "Last-Modified": "Tue, 07 Apr 2026 12:23:40 GMT"}),
        RESULTS_URL: FakeResponse(200, fixture(fixtures, "results"), {"ETag": '"r1"', "Last-Modified": "Tue, 07 Apr 2026 12:30:46 GMT"}),
    }
    mapping.update(extra)
    return fake_client(mapping)


def stage(conn, client, tmp_path, now: str = STAMP):
    return ipt.run(conn, client, now=now, work_dir=tmp_path / "work", review_dir=tmp_path / "review")


# -- reading the files ---------------------------------------------------------------------------------------


def test_the_three_files_read_as_published(fixtures, tmp_path):
    plan = ipt.read_file(write(tmp_path / "p.csv", fixture(fixtures, "plan")), ipt.PLAN, (2025, 2026))
    assert (plan.encoding, plan.read, len(plan.rows), plan.skipped, plan.extra, plan.years) == ("utf-8", 24, 24, 0, [], [2025, 2026])
    pspc = [r for r in plan.rows if r["dept_en"] == "Public Services and Procurement Canada"]
    assert [(r["fy"], r["code"], r["amount_cents"], r["amount_state"], r["amount_raw"], r["delivery_en"], r["delivery_fr"]) for r in pspc] == [
        (2025, "473", 949_796_500, "stated", "$9,497,965", "National Capital Region", "Région de la capitale nationale"),
        (2026, "473", 949_796_500, "stated", "$9,497,965", "National Capital Region", "Région de la capitale nationale"),
    ]
    assert (pspc[0]["object_en"], pspc[0]["object_fr"], pspc[0]["category_en"], pspc[0]["acronym_en"], pspc[0]["acronym_fr"]) == (
        "Information technology and telecommunications consultants", "Consultants en TI et en télécommunications", "Services", "PSPC", "SPAC")
    # "No Data Provided" as an amount, as a location and as a whole row: not provided, never zero.
    fednor = {r["code"]: r for r in plan.rows if r["acronym_en"] == "FEDNOR" and r["fy"] == 2025}
    assert (fednor["401"]["amount_cents"], fednor["401"]["amount_state"]) == (None, "not_provided")
    assert (fednor["1283"]["amount_cents"], fednor["1283"]["amount_state"]) == (500_000, "stated")
    isc = [r for r in plan.rows if r["acronym_en"] == "ISC"]
    assert {(r["delivery_en"], r["delivery_state"], r["amount_cents"]) for r in isc} == {(None, "not_provided", 500_000_000)}
    none = [r for r in plan.rows if r["kind"] == "none"]
    assert [(r["dept_en"], r["fy"], r["code"], r["amount_state"], r["delivery_state"]) for r in none] == [
        ("Health Canada", 2026, None, "not_provided", "not_provided")]
    # A no-break space in the publisher's category ("standard object\xa009") is a space.
    assert all("\xa0" not in (r["subcategory_en"] or "") for r in plan.rows)
    gaps = ipt.read_file(write(tmp_path / "g.csv", fixture(fixtures, "gaps")), ipt.GAPS, (2025, 2026))
    assert (len(gaps.rows), [r["kind"] for r in gaps.rows].count("gap"), gaps.years) == (12, 8, [2025])
    no_gap = next(r for r in gaps.rows if r["acronym_en"] == "PSPC")
    assert (no_gap["kind"], no_gap["code"], no_gap["object_en"], no_gap["object_fr"]) == (
        "none", None, "No Identified Gaps Reported by the Organization", "Aucune information fournie par l'organisation")
    results = ipt.read_file(write(tmp_path / "r.csv", fixture(fixtures, "results")), ipt.RESULTS, (2024,))
    assert (len(results.rows), results.years) == (8, [2024])
    npa = next(r for r in results.rows if r["acronym_en"] == "NPA")
    # The published percentage, never one worked out: 104 / 393 is 0.2646, the file says 0.2639.
    assert (npa["a_cents"], npa["b_cents"], npa["c_cents"], npa["pct"], npa["pct_raw"], npa["met_en"], npa["met_fr"]) == (
        10_400, 39_300, 0, 0.2639, "0.2639", "Yes", "Oui")
    pspc = next(r for r in results.rows if r["acronym_en"] == "PSPC")
    assert (pspc["a_cents"], pspc["b_cents"], pspc["pct"], pspc["met_en"], pspc["met_fr"], pspc["phase"], pspc["received_en"]) == (
        23_456_799_100, 741_334_715_400, 0.0316, "No", "Non", "1", "Yes")


def test_crlf_and_lf_read_the_same(fixtures, tmp_path):
    for part in ipt.PARTS:
        data = fixture(fixtures, part)
        a = ipt.read_file(write(tmp_path / "lf.csv", data), part, (2024, 2025, 2026))
        b = ipt.read_file(write(tmp_path / "crlf.csv", data.replace(b"\n", b"\r\n")), part, (2024, 2025, 2026))
        assert a.rows == b.rows, part


def test_the_previous_plans_gaps_file_reads_in_windows_1252_with_no_fiscal_year(fixtures, tmp_path):
    data = fixture(fixtures, "gaps_2024")
    assert not data.startswith(b"\xef\xbb\xbf") and b"\x92" in data
    parsed = ipt.read_file(write(tmp_path / "g.csv", data), ipt.GAPS, (2024, 2025))
    assert parsed.encoding == "cp1252"
    assert [(r["fy"], r["kind"], r["code"], r["dept_fr"]) for r in parsed.rows] == [
        (2024, "gap", "492", "Normes d’accessibilité Canada"), (2024, "gap", "499", "Normes d’accessibilité Canada"),
        (2024, "none", None, "Service canadien d'appui aux tribunaux administratifs")]


# The header rows of every file of the target read on 2026-11-13, as published.
HEADERS = {
    "plan 2025-26": (ipt.PLAN, "Fiscal Year/ Année financière,Organization Name - EN,Nom de l'organisation - FR,Organization Acronym - EN,"
                     "Acronyme de l'organisation - FR,Economic Object Code / Code d'article économique,Economic Object Name - EN,"
                     "Nom du code d'article économique - FR,Category - EN,Catégorie - FR,Subcategory - EN,Sous-catégorie - FR,"
                     "Reporting Object Name - EN,Article de rapport - FR,Procurement Amount/ Montant de l'approvisionnement,"
                     "Delivery Location of Goods and Services,Lieu de livraison des biens et services - FR", []),
    "plan 2024-25": (ipt.PLAN, "Fiscal Year,Organization Name - EN,Organization Name - FR,Organization Acronym - EN,Organization Acroym - FR,"
                     "Economic Object Code,Economic Object Name - EN,Economic Object Name - FR,Category - EN,Category - FR,Subcategory - EN,"
                     "Subcategory - FR,Reporting Object Name - EN,Reporting Object Name - FR,Procurement Amount,"
                     "Delivery Location of Goods and Services - EN,Delivery Location of Goods et Services - FR", []),
    "gaps 2025-26": (ipt.GAPS, "Fiscal Year/ Année financière,Organization Name - EN,Nom de l'organisation - FR,Organization Acronym - EN,"
                     "Acronyme de l'organisation - FR,Economic Object Code / Code d'article économique,Economic Object Name - EN,"
                     "Nom du code d'article économique - FR", []),
    "gaps 2024-25": (ipt.GAPS, "Organization Name - EN,Organization Name - FR,Organization Acronym - EN,Organization Acronym - FR,"
                     "Economic Object Code - EN,Economic Object Name - EN,Economic Object Name - FR", []),
    "results 2024-25": (ipt.RESULTS, "Organization Name - EN,Organization Name - FR,Organization Acronym - EN,Organization Acronym - FR,Phase,"
                        "Report Received - EN,Report Received - FR,A - All Contracts Awarded to Indigenous Business,"
                        "B - All Contracts Awarded to All Business,C - Value of  Deputy Head Approved Exceptions,"
                        "% Value of All Contracts Awarded to Indigenous Business A/(B-C),Met 5% Target - EN,Met 5% Target - FR,Fiscal Year", []),
    "results 2023-24": (ipt.RESULTS, "Organization Name - EN,Organization Name - FR,Organization Acronym - EN,Organization Acronym - FR,Phase ,"
                        "Report Received - EN,Report Received - FR,A - All Contracts Awarded to Indigenous Business ,"
                        "B - All Contracts Awarded to All Business,C - Value of  Deputy Head Approved Exceptions,"
                        "% of All Contracts Awarded to Indigenous Business A or (B - C),Met 5% Target,Met 5% Target FR,Fiscal Year", []),
    "results 2022-23": (ipt.RESULTS, "Organization Name,Organization Name - FR,Organization Acronym,Organization Acronym - FR,Phase ,"
                        "Report Received,Report Received - FR,A - All Contracts to Indigenous Business ,B - All Contracts Awarded to All Business,"
                        "C - Value of total contracts Deputy Head approved exceptions,% of all contracts awarded to Indigenous business A / (B - C),"
                        "Meet 5% Target,Meet 5% Target - FR,Fiscal Year,Comment,Comment - FR", ["Comment", "Comment - FR"]),
}


@pytest.mark.parametrize("layout", sorted(HEADERS))
def test_every_header_layout_of_the_real_files_maps_each_column(layout):
    part, line, extra = HEADERS[layout]
    headers = line.split(",")
    found, unread = ipt.columns(headers, part, layout)
    assert unread == extra
    required = {name for name, _, req in ipt.COLUMNS[part] if req}
    assert required <= set(found)
    # Each column read once, and each field from its own column.
    assert len(set(found.values())) == len(found)


def test_a_renamed_column_is_refused_before_a_row_is_written(conn, world, fixtures, tmp_path):
    load_all(conn, fixtures, tmp_path)
    before = [tuple(r) for r in rows(conn, "ipt_results")]
    data = fixture(fixtures, "results").replace(b"Met 5% Target - EN", b"Target Status - EN")
    with pytest.raises(contracts.LayoutError, match="lacks the column for met_en"):
        ipt.read_file(write(tmp_path / "r.csv", data), ipt.RESULTS, (2024,))
    assert [tuple(r) for r in rows(conn, "ipt_results")] == before
    # Two columns that read as one field are refused too.
    with pytest.raises(contracts.LayoutError, match="2 columns read as fy"):
        ipt.columns(["Fiscal Year", "Fiscal Year/ Année financière", "Organization Name - EN", "Organization Name - FR",
                     "Economic Object Code", "Economic Object Name - EN", "Economic Object Name - FR"], ipt.GAPS, "gaps")


def test_rows_of_a_year_the_dataset_does_not_cover_are_counted_and_a_file_with_none_is_refused(fixtures, tmp_path):
    parsed = ipt.read_file(write(tmp_path / "p.csv", fixture(fixtures, "plan")), ipt.PLAN, (2026, 2027))
    assert parsed.years == [2026] and sum(parsed.other_years.values()) == 16
    with pytest.raises(contracts.LayoutError, match="no row of the fiscal years"):
        ipt.read_file(write(tmp_path / "r.csv", fixture(fixtures, "results")), ipt.RESULTS, (2025,))
    # A samples run takes the rows' own years, two at most for a plan and one for the results.
    assert ipt.read_file(write(tmp_path / "s.csv", fixture(fixtures, "plan")), ipt.PLAN).years == [2025, 2026]
    mixed = fixture(fixtures, "results").replace(b",Yes,Oui,2024-25\n", b",Yes,Oui,2023-24\n", 1)
    with pytest.raises(contracts.LayoutError, match="fiscal years 2023, 2024"):
        ipt.read_file(write(tmp_path / "m.csv", mixed), ipt.RESULTS)


def test_amounts_percentages_years_and_the_no_data_words():
    assert ipt.amount("$1,500,000 ") == (150_000_000, "stated", "$1,500,000")
    assert ipt.amount("$99,999.99") == (9_999_999, "stated", "$99,999.99")
    assert ipt.amount("-47438") == (-4_743_800, "stated", "-47438")
    assert ipt.amount("No Data Provided/Aucune donnée n’a été fournie") == (None, "not_provided", "No Data Provided/Aucune donnée n’a été fournie")
    assert ipt.amount("") == (None, "blank", None)
    assert ipt.amount("TBD") == (None, "text", "TBD")
    assert ipt.percentage("0.0647") == (0.0647, "stated", "0.0647")
    assert ipt.percentage("6.48%")[0] == pytest.approx(0.0648)
    assert ipt.percentage("No Data Provided")[1] == "not_provided" and ipt.percentage("")[1] == "blank"
    assert ipt.fiscal_year("2025-26") == 2025 and ipt.fiscal_year("2025-2026") == 2025 and ipt.fiscal_year("2024/2025") == 2024
    assert ipt.fiscal_year("2025-27") is None and ipt.fiscal_year("") is None
    assert ipt.object_code("No Data Provided/ Aucune donnée n’a été fournie") is None and ipt.object_code("NIL") is None
    assert ipt.object_code(" 1283 ") == "1283"
    assert ipt.is_no_data("Aucune donnée n'a été fournie") and not ipt.is_no_data("No Identified Gaps Reported by the Organization")


# -- institutions to buyers -----------------------------------------------------------------------------------


def test_institutions_resolve_to_buyers_and_one_with_no_ckan_organization_is_listed(conn, world, fixtures, tmp_path, out_dir):
    linked = load_all(conn, fixtures, tmp_path)
    by = {r["dept_en"]: r["buyer_id"] for r in rows(conn, "ipt_results")}
    assert by == {
        "Accessibility Standards Canada": "casdo-ocena", "Administrative Tribunals Support Service of Canada": "atssc-scdata",
        "Federal Economic Development Agency for Northern Ontario": "fednor", "Health Canada": "hc-sc",
        "Indigenous Services Canada": "isc-sac", "Leaders Debates Commission": "leaders-debates-commission",
        # The seed's row for the Public Accounts' legal name.
        "Northern Pipeline Agency": "npa-apn", "Public Services and Procurement Canada": "pwgsc-tpsgc",
    }
    assert (len(linked.institutions), linked.mapped, linked.unmapped, linked.shared) == (8, 7, [], [])
    # No CKAN organization holds the Leaders' Debates Commission (read 2026-11-13), so no seed row ties it to one.
    assert linked.made == [("Leaders Debates Commission", "Commission des débats des chefs", "leaders-debates-commission")]
    # Every file's rows carry the same buyer for the same institution.
    for table in ("ipt_plans", "ipt_gaps"):
        assert {(r["dept_en"], r["buyer_id"]) for r in rows(conn, table)} <= set(by.items())


def test_a_match_to_a_province_or_a_territory_is_listed_and_gets_no_block(conn, world, fixtures, tmp_path):
    """CKAN lists the provinces and territories as organizations, so they are buyers too; the files name federal
    institutions only, and a name resolving to a province is a wrong match."""
    buyers.upsert_ckan(conn, {"name": "on", "title_translated": {"en": "Government of Ontario", "fr": "Gouvernement de l'Ontario"},
                              "shortform": {"en": "ON", "fr": "ON"}}, now=STAMP)
    conn.execute("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES ('Federal Economic Development Agency for Northern "
                 "Ontario', 'indigenous_target', 'on')")
    conn.commit()
    linked = load_all(conn, fixtures, tmp_path)
    assert linked.provincial == [("Federal Economic Development Agency for Northern Ontario",
                                  "Agence fédérale de développement économique pour le Nord de l’Ontario", "on")]
    assert linked.mapped == 6
    blocks = ipt.buyer_blocks(conn, listed=world | {"on"})
    assert "on" not in blocks and "fednor" not in blocks and "pwgsc-tpsgc" in blocks
    review = ipt.write_review(conn, linked, tmp_path / "review.txt", stamp=STAMP)
    assert review and "Federal Economic Development Agency for Northern Ontario\t" in (tmp_path / "review.txt").read_text(encoding="utf-8")


def test_the_nightly_relink_follows_a_buyer_merge(conn, world, fixtures, tmp_path):
    load_all(conn, fixtures, tmp_path)
    # The buyers stage merged the made buyer into a CKAN organization: its spellings now name that one.
    conn.execute("INSERT INTO buyers (id, name_en, ckan_org, updated_at) VALUES ('ldc-cdc', 'Leaders'' Debates Commission', 'ldc-cdc', ?)", (STAMP,))
    conn.execute("UPDATE buyer_names SET buyer_id = 'ldc-cdc' WHERE buyer_id = 'leaders-debates-commission'")
    conn.commit()
    linked = ipt.relink(conn, stamp=STAMP)
    assert {r["buyer_id"] for r in rows(conn, "ipt_results") if r["acronym_en"] == "LDC"} == {"ldc-cdc"}
    assert linked.changed == 4 and linked.made == []
    assert ipt.relink(conn, stamp=STAMP).changed == 0


def test_a_new_copy_replaces_the_part_whole_and_a_fault_leaves_the_rows_before(conn, world, fixtures, tmp_path, monkeypatch):
    load_all(conn, fixtures, tmp_path)
    first = [tuple(r) for r in rows(conn, "ipt_gaps")]
    load(conn, fixtures, tmp_path, ipt.GAPS)
    assert [tuple(r) for r in rows(conn, "ipt_gaps")] == first
    fewer = b"\n".join(line for line in fixture(fixtures, "gaps").split(b"\n") if b"Health Canada" not in line)
    load(conn, fixtures, tmp_path, ipt.GAPS, fewer)
    assert len(rows(conn, "ipt_gaps")) == len(first) - 6
    before = [tuple(r) for r in rows(conn, "ipt_gaps")]

    def broken(*args, **kwargs):
        raise RuntimeError("relink broke")

    monkeypatch.setattr(ipt, "relink", broken)
    with pytest.raises(RuntimeError):
        load(conn, fixtures, tmp_path, ipt.GAPS)
    assert [tuple(r) for r in rows(conn, "ipt_gaps")] == before


# -- finding the datasets ------------------------------------------------------------------------------------


def test_the_newest_plan_and_results_are_told_by_their_titles():
    records = [plan_record(), plan_record(OLD_PLAN_DS, "2024-2025 and 2025-2026"), results_record(),
               results_record("5d27d152-09d8-4303-adc4-0c46b4a9733b", "2023-2024")]
    found = [ipt.classify(r, "search") for r in records]
    assert [(d.kind, d.fy, d.fy_last) for d in found] == [("plan", 2025, 2026), ("plan", 2024, 2025), ("results", 2024, 2024),
                                                          ("results", 2023, 2023)]
    assert ipt._newest([d for d in found if d.kind == "plan"]).id == PLAN_DS
    # Another publisher's record, or a title of neither kind, is no candidate.
    assert ipt.classify({**plan_record(), "organization": {"name": "tbs-sct"}}, "search") is None
    assert ipt.classify({**plan_record(), "title_translated": {"en": "Indigenous Business Directory"}}, "search") is None
    assert ipt.classify({**results_record(), "title_translated": {"en": "Results of the Mandatory Minimum 5% Indigenous "
                                                                   "Procurement Target for Fiscal Year 2024-2026"}}, "search") is None


def test_the_files_are_told_by_their_names_never_by_their_address():
    notices: list[str] = []
    files = ipt.resources(ipt.classify(plan_record(), "search"), notices)
    assert [(r.part, r.url, r.resource_id, r.name_en) for r in files] == [
        ("plan", PLAN_URL, "2c4492e4-d555-4ba4-9222-575aec94011e", "2025-26 and 2026-27 Planned Procurement"),
        ("gaps", GAPS_URL, "a8b56549-c3d1-47f4-9fd7-11931b0933d9", "2025-26 and 2026-27 Gaps in Indigenous Procurement")]
    assert files[0].file == files[1].file == SHARED and notices == []
    (results,) = ipt.resources(ipt.classify(results_record(), "search"), notices)
    assert (results.part, results.url, results.years) == ("results", RESULTS_URL, (2024,))
    # The search's addresses from the catalogue's root are made whole: the same address as the record's own.
    found = ipt.resources(ipt.classify(relative(plan_record()), "search"), notices)
    assert [r.url for r in found] == [PLAN_URL, GAPS_URL] and relative(plan_record())["resources"][1]["url"].startswith("/data/dataset/")
    # The previous plan's gaps file had another name.
    old = plan_record()
    old["resources"][-1]["name_translated"]["en"] = "Goods and Services Where Organizations Identified Indigenous Business Capacity Gaps"
    assert [r.part for r in ipt.resources(ipt.classify(old, "search"), notices)] == ["plan", "gaps"]


def test_a_dataset_under_another_licence_or_without_a_file_is_a_notice():
    notices: list[str] = []
    assert ipt.resources(ipt.classify(plan_record(licence="other"), "search"), notices) == []
    assert "is under licence 'other', not ca-ogl-lgo; it was not read" in notices[0]
    files = ipt.resources(ipt.classify(plan_record(gaps=False), "search"), notices)
    assert [r.part for r in files] == ["plan"] and "lists 0 files that read as the gaps" in notices[1]


# -- the stage: cadence, fallbacks, failures ---------------------------------------------------------------------


def test_the_stage_reads_the_files_once_and_then_asks_only_the_catalogue_when_due(conn, world, fixtures, fake_client, tmp_path):
    client = client_for(fake_client, fixtures)
    calls = client.fake_session.calls
    result = stage(conn, client, tmp_path)
    assert result.state == "read" and [c[0] for c in calls] == [SEARCH, PLAN_URL, GAPS_URL, RESULTS_URL]
    row = log_row(conn)
    assert row["ok"] == 1 and row["detail"] == (
        "read plan=2025-26/2026-27 (search) results=2024-25 (search) states=read,read,read rows=24/12/8 institutions=8 "
        "mapped=7 made=1 provincial=0 unmapped=0 held=none")
    assert row["rows_in"] == 44 and row["rows_new"] == 44
    files = {r["part"]: r for r in conn.execute("SELECT * FROM ipt_files")}
    assert (files["plan"]["dataset_id"], files["plan"]["found"], files["plan"]["fy"], files["plan"]["fy_last"], files["plan"]["etag"],
            files["plan"]["encoding"], files["plan"]["name_en"]) == (PLAN_DS, "search", 2025, 2026, '"p1"', "utf-8",
                                                                     "2025-26 and 2026-27 Planned Procurement")
    assert (files["results"]["dataset_id"], files["results"]["fy"]) == (RESULTS_DS, 2024)
    # An hour later: not due, no request at all.
    calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-14T04:00:00Z").state == "not due" and calls == []
    # The next night: the search is read, it lists the same files, nothing is downloaded.
    assert stage(conn, client, tmp_path, now="2026-11-15T03:00:00Z").state == "unchanged" and [c[0] for c in calls] == [SEARCH]
    assert conn.execute("SELECT COUNT(*) FROM sources_log WHERE source = 'indigenous_target'").fetchone()[0] == 3


def test_a_changed_record_sends_a_conditional_request_and_the_same_bytes_are_not_read_again(conn, world, fixtures, fake_client, tmp_path):
    client = client_for(fake_client, fixtures)
    stage(conn, client, tmp_path)
    applied = conn.execute("SELECT applied_at FROM ipt_files WHERE part = 'plan'").fetchone()[0]
    client.fake_session.mapping[SEARCH] = search(plan_record(modified="2026-11-01T00:00:00"), results_record())
    client.fake_session.mapping[PLAN_URL] = FakeResponse(304)
    client.fake_session.mapping[GAPS_URL] = FakeResponse(200, fixture(fixtures, "gaps"), {"ETag": '"g2"'})
    client.fake_session.calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-15T03:00:00Z").state == "unchanged"
    sent = {c[0]: c[1] for c in client.fake_session.calls}
    assert sent[PLAN_URL].get("If-None-Match") == '"p1"' and sent[GAPS_URL].get("If-None-Match") == '"g1"'
    files = {r["part"]: r for r in conn.execute("SELECT * FROM ipt_files")}
    assert (files["plan"]["applied_at"], files["plan"]["ckan_modified"]) == (applied, "2026-11-01T00:00:00")
    assert files["gaps"]["etag"] == '"g2"' and files["gaps"]["applied_at"] == applied


def test_the_known_datasets_are_read_when_the_search_fails_and_the_log_says_so(conn, world, fixtures, fake_client, tmp_path):
    client = client_for(fake_client, fixtures, **{
        SEARCH: FakeResponse(503), SHOW.format(dataset=PLAN_DS): show(plan_record()), SHOW.format(dataset=RESULTS_DS): show(results_record()),
    })
    result = stage(conn, client, tmp_path)
    row = log_row(conn)
    assert result.state == "read" and row["ok"] == 1
    assert "plan=2025-26/2026-27 (fallback) results=2024-25 (fallback)" in row["detail"]
    assert "the catalogue search could not be read" in row["notice"]
    assert f"the plan dataset was not found by the search; the known dataset {PLAN_DS} was read" in row["notice"]
    assert {r["found"] for r in conn.execute("SELECT found FROM ipt_files")} == {"fallback"}


def test_a_night_on_the_known_datasets_after_one_on_the_search_downloads_nothing(conn, world, fixtures, fake_client, tmp_path):
    client = client_for(fake_client, fixtures, **{
        SHOW.format(dataset=PLAN_DS): show(plan_record()), SHOW.format(dataset=RESULTS_DS): show(results_record()),
    })
    stage(conn, client, tmp_path)
    client.fake_session.mapping[SEARCH] = FakeResponse(404)
    client.fake_session.calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-15T03:00:00Z").state == "unchanged"
    assert [c[0] for c in client.fake_session.calls] == [SEARCH, SHOW.format(dataset=PLAN_DS), SHOW.format(dataset=RESULTS_DS)]
    assert {r[0] for r in conn.execute("SELECT found FROM ipt_files")} == {"fallback"}


def test_a_newer_plan_found_by_the_search_replaces_the_one_applied(conn, world, fixtures, fake_client, tmp_path):
    client = client_for(fake_client, fixtures)
    stage(conn, client, tmp_path)
    newer = "aaaaaaaa-1111-2222-3333-444444444444"
    plan_url, gaps_url = f"{BASE}{newer}/resource/p27/download/{SHARED}", f"{BASE}{newer}/resource/g27/download/{SHARED}"
    # The next plan covers 2026-27 and 2027-28: each year moved on by one, the later first.
    data = fixture(fixtures, "plan").replace(b"\n2026-27,", b"\n2027-28,").replace(b"\n2025-26,", b"\n2026-27,")
    client.fake_session.mapping.update({
        SEARCH: search(plan_record(), plan_record(newer, "2026-2027 and 2027-2028", plan_url=plan_url, gaps_url=gaps_url), results_record()),
        plan_url: FakeResponse(200, data), gaps_url: FakeResponse(200, fixture(fixtures, "gaps").replace(b"\n2025-26,", b"\n2026-27,")),
    })
    assert stage(conn, client, tmp_path, now="2026-11-15T03:00:00Z").state == "read"
    files = {r["part"]: r for r in conn.execute("SELECT * FROM ipt_files")}
    assert (files["plan"]["dataset_id"], files["plan"]["fy"], files["gaps"]["dataset_id"]) == (newer, 2026, newer)
    assert {r["fy"] for r in rows(conn, "ipt_plans")} == {2026, 2027} and {r["fy"] for r in rows(conn, "ipt_gaps")} == {2026}


def test_a_failed_search_and_download_and_an_unknown_layout_end_ok_with_a_notice(conn, world, fixtures, fake_client, tmp_path):
    client = client_for(fake_client, fixtures)
    stage(conn, client, tmp_path)
    before = {t: [tuple(r) for r in rows(conn, t)] for t in ipt.TABLES.values()}
    # The catalogue does not answer and no known dataset does either.
    client.fake_session.mapping[SEARCH] = FakeResponse(404)
    result = stage(conn, client, tmp_path, now="2026-11-15T03:00:00Z")
    row = log_row(conn)
    assert (result.state, row["ok"]) == ("not read", 1) and "no plan dataset could be found; the rows stand" in row["notice"]
    # A new copy the host refuses.
    client.fake_session.mapping[SEARCH] = search(plan_record(modified="2026-11-09T00:00:00"), results_record())
    client.fake_session.mapping[PLAN_URL] = FakeResponse(403)
    stage(conn, client, tmp_path, now="2026-11-16T03:00:00Z")
    row = log_row(conn)
    assert row["ok"] == 1 and "the plan file" in row["notice"] and "could not be downloaded" in row["notice"]
    # A new copy whose layout is not known: refused, and not downloaded again while the record lists the same copy.
    client.fake_session.mapping[PLAN_URL] = FakeResponse(200, fixture(fixtures, "plan").replace(b"Procurement Amount", b"Planned Value"))
    result = stage(conn, client, tmp_path, now="2026-11-17T03:00:00Z")
    row = log_row(conn)
    assert (result.states["plan"], row["ok"]) == ("refused", 1) and "lacks the column for amount" in row["notice"]
    client.fake_session.calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-18T03:00:00Z").states["plan"] == "refused"
    assert PLAN_URL not in [c[0] for c in client.fake_session.calls] and "held=plan" in log_row(conn)["detail"]
    assert {t: [tuple(r) for r in rows(conn, t)] for t in ipt.TABLES.values()} == before
    assert all(r["ok"] == 1 for r in conn.execute("SELECT ok FROM sources_log WHERE source = 'indigenous_target'"))


def test_a_copy_of_the_same_dataset_with_far_fewer_rows_is_held_until_released(conn, world, fixtures, fake_client, tmp_path, monkeypatch):
    client = client_for(fake_client, fixtures)
    stage(conn, client, tmp_path)
    before = [tuple(r) for r in rows(conn, "ipt_plans")]
    short = b"\n".join(fixture(fixtures, "plan").split(b"\n")[:6]) + b"\n"
    client.fake_session.mapping[SEARCH] = search(plan_record(modified="2026-11-09T00:00:00"), results_record())
    client.fake_session.mapping[PLAN_URL] = FakeResponse(200, short)
    monkeypatch.setattr(config, "IPT_RELEASE", tmp_path / "release.txt")
    result = stage(conn, client, tmp_path, now="2026-11-15T03:00:00Z")
    row = log_row(conn)
    assert (result.states["plan"], row["ok"]) == ("held", 1) and "5 rows against 24" in row["notice"]
    assert [tuple(r) for r in rows(conn, "ipt_plans")] == before
    held = ipt.holds(conn)["plan"]
    (tmp_path / "release.txt").write_text(held["sha256"][:12] + "\n", encoding="utf-8")
    assert stage(conn, client, tmp_path, now="2026-11-16T03:00:00Z").states["plan"] == "read"
    assert len(rows(conn, "ipt_plans")) == 5 and "plan" not in ipt.holds(conn)


def test_a_change_of_rules_reads_the_files_again_from_their_addresses(conn, world, fixtures, fake_client, tmp_path, monkeypatch):
    client = client_for(fake_client, fixtures)
    stage(conn, client, tmp_path)
    monkeypatch.setattr(ipt, "RULES_VERSION", ipt.RULES_VERSION + 1)
    client.fake_session.calls.clear()
    result = stage(conn, client, tmp_path, now="2026-11-14T04:00:00Z")
    assert result.state == "read" and sorted(c[0] for c in client.fake_session.calls) == sorted([PLAN_URL, GAPS_URL, RESULTS_URL])
    assert all("If-None-Match" not in c[1] for c in client.fake_session.calls)
    assert {r[0] for r in conn.execute("SELECT rules FROM ipt_files")} == {ipt.rules()}


def test_the_review_file_lists_the_unmapped_institutions_and_nothing_reaches_the_log_but_counts(conn, world, fixtures, fake_client, tmp_path):
    stage(conn, client_for(fake_client, fixtures), tmp_path)
    review = (tmp_path / "review" / ipt.REVIEW_FILE).read_bytes()
    assert b"\r" not in review
    text = review.decode("utf-8")
    assert "Leaders Debates Commission\tCommission des débats des chefs\tleaders-debates-commission" in text
    assert ("## Institutions: 8, 7 to a federal CKAN or seed buyer, 1 to a buyer the resolver made, 0 to a province or "
            "territory, 0 to none") in text
    assert "plan\t24\tnone/not_provided 1, row/not_provided 4, row/stated 19" in text
    detail = log_row(conn)["detail"]
    assert "Leaders" not in detail and "Health" not in detail


def test_a_samples_run_reads_the_samples_and_makes_no_request(conn, world, fixtures, tmp_path, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("a samples run made a request")

    monkeypatch.setattr(cli, "PoliteClient", no_network)
    assert cli.run(conn, ["indigenous_target"], samples=tmp_path) == 0
    assert "no ipt-plan.csv in the samples folder" in log_row(conn)["notice"]
    for part, name in ipt.SAMPLE_NAMES.items():
        shutil.copy(fixtures / f"indigenous_target_{part}.csv", tmp_path / name)
    assert cli.run(conn, ["indigenous_target"], samples=tmp_path) == 0
    assert log_row(conn)["detail"].startswith("read plan=2025-26/2026-27 (sample) results=2024-25 (sample)")


def test_a_fault_in_the_stage_fails_it_and_the_stages_after_it_run(conn, world, fixtures, tmp_path, monkeypatch):
    shutil.copy(fixtures / "indigenous_target_plan.csv", tmp_path / ipt.SAMPLE_NAMES["plan"])

    def broken(*args, **kwargs):
        raise KeyError("a bug")

    monkeypatch.setattr(ipt, "read_file", broken)
    assert cli.run(conn, ["indigenous_target", "families"], samples=tmp_path) == 1
    by = {r["source"]: r for r in conn.execute("SELECT source, ok, detail FROM sources_log")}
    assert by["indigenous_target"]["ok"] == 0 and "KeyError" in by["indigenous_target"]["detail"]
    assert by["families"]["ok"] == 1


def test_the_stage_runs_after_public_accounts_and_before_the_export():
    assert cli.STAGES.index("indigenous_target") == cli.STAGES.index("public_accounts") + 1
    assert cli.STAGES.index("indigenous_target") < cli.STAGES.index("families") < cli.STAGES.index("export")


def test_the_catalogue_is_read_every_night(conn):
    assert ipt.due(conn, STAMP)
    set_meta(conn, ipt.META_CHECKED, "2026-11-14T03:00:00Z")
    assert not ipt.due(conn, "2026-11-14T22:00:00Z") and ipt.due(conn, "2026-11-14T23:00:00Z")


# -- what the export writes -----------------------------------------------------------------------------------


def test_the_buyer_block_holds_the_plan_the_gaps_and_the_result_as_published(conn, world, fixtures, tmp_path):
    load_all(conn, fixtures, tmp_path)
    blocks = ipt.buyer_blocks(conn, listed=world | {"leaders-debates-commission"})
    assert set(blocks) == world | {"leaders-debates-commission"}
    assert blocks["pwgsc-tpsgc"] == {
        "v": 1,
        "objects": {"473": ["Information technology and telecommunications consultants", "Consultants en TI et en télécommunications",
                            "Services", "Services"]},
        "plan": {"ds": PLAN_DS, "fy": [2025, 2026], "years": [
            {"fy": 2025, "n": 1, "rows": [["473", 9_497_965, ["National Capital Region", "Région de la capitale nationale"]]]},
            {"fy": 2026, "n": 1, "rows": [["473", 9_497_965, ["National Capital Region", "Région de la capitale nationale"]]]},
        ]},
        "gaps": {"ds": PLAN_DS, "years": [{"fy": 2025, "n": 0, "keys": [], "none": [
            "No Identified Gaps Reported by the Organization", "Aucune information fournie par l'organisation"]}]},
        "result": {"ds": RESULTS_DS, "fy": 2024, "a": 234_567_991, "b": 7_413_347_154, "c": 0, "pct": 0.0316, "met": ["No", "Non"]},
    }
    # Not provided is "np", never 0; rows by category, stated amounts largest first; a location written once in both.
    fednor = blocks["fednor"]["plan"]["years"][0]["rows"]
    assert fednor == [["1283", 5_000, ["Ontario", None]], ["401", "np", ["Ontario", None]], ["351", "np", ["Ontario", None]]]
    assert blocks["isc-sac"]["plan"]["years"][0]["rows"] == [["813", 5_000_000, "np"]]
    # A year the file gives no data for.
    hc = blocks["hc-sc"]
    assert [(y["fy"], y["n"], y.get("np")) for y in hc["plan"]["years"]] == [(2025, 7, None), (2026, 0, 1)]
    assert hc["gaps"]["years"][0]["keys"] == ["1130", "1243", "451", "460", "660", "431"]
    # A gap's names when the plan has no row of its code, with no category.
    assert hc["objects"]["1130"][2:] == [None, None] and hc["objects"]["473"][2:] == ["Services", "Services"]
    assert blocks["npa-apn"]["result"]["pct"] == 0.2639
    assert ipt.buyer_blocks(conn, listed=set()) == {}
    assert ipt.buyer_blocks(conn, listed={"pwgsc-tpsgc"}) == {"pwgsc-tpsgc": blocks["pwgsc-tpsgc"]}


def test_a_part_two_institutions_of_one_file_resolve_to_is_left_out(conn, world, fixtures, tmp_path):
    load_all(conn, fixtures, tmp_path)
    # Health Canada's results row resolved to Public Services and Procurement Canada as well.
    conn.execute("UPDATE ipt_results SET buyer_id = 'pwgsc-tpsgc' WHERE acronym_en = 'HC'")
    conn.commit()
    block = ipt.buyer_blocks(conn, listed=world)["pwgsc-tpsgc"]
    assert "result" not in block and "plan" in block and "gaps" in block
    shared = ipt.owners_by_part(conn)["results"]["pwgsc-tpsgc"]
    assert shared == {"Health Canada", "Public Services and Procurement Canada"}


def test_the_caps_hold_and_the_count_says_how_many_rows_there_are(conn, world, fixtures, tmp_path, monkeypatch):
    load_all(conn, fixtures, tmp_path)
    monkeypatch.setattr(ipt, "IPT_PLAN_ROWS", 2)
    monkeypatch.setattr(ipt, "IPT_GAP_ROWS", 2)
    hc = ipt.buyer_blocks(conn, listed=world)["hc-sc"]
    assert (hc["plan"]["years"][0]["n"], len(hc["plan"]["years"][0]["rows"])) == (7, 2)
    assert (hc["gaps"]["years"][0]["n"], len(hc["gaps"]["years"][0]["keys"])) == (6, 2)


def test_no_other_module_reads_the_tables():
    """The target's figures meet no contract value: only this stage and the export's one guarded block read them."""
    package = Path(ipt.__file__).resolve().parents[1]
    readers = sorted(p.relative_to(package).as_posix() for p in package.rglob("*.py")
                     if any(t in p.read_text(encoding="utf-8") for t in ("ipt_plans", "ipt_gaps", "ipt_results", "ipt_files")))
    assert readers == ["sources/indigenous_target.py"]
    text = (package / "export_static.py").read_text(encoding="utf-8")
    assert text.count("indigenous_target.buyer_blocks(") == 1
    for schema in ("records_schema.sql", "search_schema.sql", "intraday_schema.sql"):
        assert "ipt_" not in (package.parent / schema).read_text(encoding="utf-8"), schema


def test_a_fault_in_the_block_builder_leaves_the_block_out_with_a_notice(conn, world, fixtures, tmp_path):
    load_all(conn, fixtures, tmp_path)

    def broken():
        raise ValueError("bad block")

    assert export_static.indigenous_target_blocks(conn, broken) == {}
    row = conn.execute("SELECT ok, notice FROM sources_log WHERE source = 'export_indigenous_target'").fetchone()
    assert row["ok"] == 1 and "left out of the buyer files tonight (ValueError: bad block)" in row["notice"]


def test_the_data_page_lists_each_file_applied_with_the_two_of_one_name_told_apart(conn, world, fixtures, tmp_path):
    rows_ = [r for r in export_static.source_files(conn) if r["source"] == "indigenous_target"]
    assert rows_ == [{"source": "indigenous_target", "file": "planned procurement, gaps, results", "last_read": None,
                      "last_modified": None, "last_modified_http": None, "loaded": False}]
    load_all(conn, fixtures, tmp_path)
    rows_ = [r for r in export_static.source_files(conn) if r["source"] == "indigenous_target"]
    assert [r["file"] for r in rows_] == ["03cb0d81-fe7a-45bf-b933-f7a78bdf2ef2-1.csv", f"{SHARED} (res-gaps)", f"{SHARED} (res-plan)"]
    assert all(r["loaded"] and r["last_read"] == STAMP and r["last_modified"] == "2026-04-07T12:23:10Z" for r in rows_)


def test_the_site_holds_the_same_figures():
    """site/src/indigenous_target.tsx reads the block with the same caps and the same known datasets."""
    site = Path(ipt.__file__).resolve().parents[3] / "site" / "src"
    text = (site / "indigenous_target.tsx").read_text(encoding="utf-8")
    assert f"export const IPT_PLAN_ROWS = {ipt.IPT_PLAN_ROWS};" in text
    assert f"export const IPT_GAP_ROWS = {ipt.IPT_GAP_ROWS};" in text
    assert f'export const IPT_NP = "{ipt.NP}";' in text
