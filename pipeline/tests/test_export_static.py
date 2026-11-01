"""The static export: every file the site reads passes the site's own checks
(a port of site/src/data.ts), the shard rule, the withheld supplier, what never
leaves the database, determinism, the file-count and size checks, and a failing
section."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path

import pytest

from awardwatch_pipeline import export_static as es
from awardwatch_pipeline.db import connect, log_run
from export_seed import (ACME, COLON_REF, CONTACT_EMAIL, CONTACT_NAME, CONTACT_PHONE, FOREIGN, NORTH, PERSON,
                         PERSON_STREET, PROSE_EMAIL, PROSE_PHONES, SERVANT, SLASH_REF, SUPPLIER_POSTAL, SUPPLIER_STREET,
                         TODAY, seed)

BASE = "https://awardwatch.example"


@pytest.fixture
def exported(conn, tmp_path):
    ids = seed(conn)
    out = tmp_path / "static"
    counts = es.export_static(conn, out, today=TODAY, base_url=BASE)
    return conn, out, ids, counts


def load(out: Path, rel: str):
    return json.loads((out / rel).read_text(encoding="utf-8"))


# -- the site's checks, as site/src/data.ts writes them --------------------------------

ORG_ID = re.compile(r"^org-[0-9a-f]{10}$")
BUYER_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REFERENCE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
MONEY = ("awards", "history", "contracts", "grants")


def s(v):
    return isinstance(v, str)


def s_or_none(v):
    return v is None or isinstance(v, str)


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def num_or_none(v):
    return v is None or num(v)


def count(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def strs(v):
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


def strs_or_none(v):
    return v is None or strs(v)


def every(v, check):
    return isinstance(v, list) and all(check(x) for x in v)


def org_or_none(v):
    return v is None or (s(v) and ORG_ID.match(v))


def buyer_or_none(v):
    return v is None or (s(v) and BUYER_ID.match(v))


def ref(v):
    return s(v) and REFERENCE.match(v)


def competitive(v):
    return v is None or isinstance(v, bool) or v in (0, 1)


def tender_row(r):
    return (isinstance(r, dict) and ref(r["reference"]) and num(r["amendment"]) and s_or_none(r["title_en"])
            and s_or_none(r["title_fr"]) and buyer_or_none(r["buyer_id"]) and s_or_none(r["buyer_en"])
            and s_or_none(r["buyer_fr"]) and s_or_none(r["published"]) and s_or_none(r["closing"])
            and strs(r["category"]) and s_or_none(r["notice_type_en"]) and s_or_none(r["notice_type_fr"])
            and s_or_none(r["method_en"]) and s_or_none(r["method_fr"]) and strs(r["segments"]) and strs(r["provinces"])
            and s(r["first_seen"]) and (s(r["status"]) if "status" in r else True))


def award_row(r):
    return (isinstance(r, dict) and ref(r["reference"]) and s_or_none(r["title_en"]) and s_or_none(r["title_fr"])
            and org_or_none(r["organization_id"]) and s_or_none(r["organization"]) and buyer_or_none(r["buyer_id"])
            and s_or_none(r["buyer_en"]) and s_or_none(r["buyer_fr"]) and s_or_none(r["awarded"])
            and num_or_none(r["value"]) and s_or_none(r["currency"]) and competitive(r["competitive"])
            and s_or_none(r["instrument_en"]) and s_or_none(r["instrument_fr"]) and strs(r["segments"])
            and strs(r["provinces"]) and (s(r["status"]) if "status" in r else True))


def contract_row(r):
    return (s(r["owner_org"]) and s(r["reference"]) and s_or_none(r["procurement_id"]) and buyer_or_none(r["buyer_id"])
            and s_or_none(r["buyer_en"]) and s_or_none(r["buyer_fr"]) and s_or_none(r["contract_date"])
            and num_or_none(r["value"]) and num_or_none(r.get("value_last_reported")) and s_or_none(r["description_en"])
            and s_or_none(r["description_fr"]) and competitive(r["competitive"]) and s_or_none(r["solicitation_procedure"])
            and s_or_none(r["instrument_type"]) and s_or_none(r["reporting_period"]))


def grant_row(r):
    return (s(r["owner_org"]) and s(r["reference"]) and num(r["amendment"]) and buyer_or_none(r["buyer_id"])
            and s_or_none(r["buyer_en"]) and s_or_none(r["buyer_fr"]) and s_or_none(r["agreement_type"])
            and s_or_none(r["program_en"]) and s_or_none(r["program_fr"]) and s_or_none(r["title_en"])
            and s_or_none(r["title_fr"]) and num_or_none(r["value"]) and s_or_none(r["start"]) and s_or_none(r["end"]))


def lobby_row(r):
    return (s(r["comm_number"]) and s_or_none(r["comm_date"]) and s_or_none(r["registrant"])
            and strs(r["subject_matters"]) and strs(r["institutions"])
            and every(r["dpoh"], lambda d: s(d["name"]) and s_or_none(d["title"]) and s_or_none(d["institution"])))


def org_total(r):
    return s(r["id"]) and ORG_ID.match(r["id"]) and s(r["name"]) and count(r["n"]) and num_or_none(r["total"]) \
        and s_or_none(r.get("province"))


def year_figure(r):
    return (isinstance(r["year"], int) and r["source"] in MONEY and count(r["n"]) and num_or_none(r["total"])
            and num_or_none(r["n_non_competitive"]) and num_or_none(r["total_non_competitive"]))


def code_row(r):
    return s(r["code"]) and s_or_none(r["desc_en"]) and s_or_none(r["desc_fr"])


BI_TEXT = ("title", "notice_type", "method", "selection", "limited_reason", "description")
BI_LISTS = ("trade_agreements", "regions_delivery")


def tender_detail(v, key):
    return (ref(v["reference"]) and v["reference"].lower() == key and num(v["amendment"]) and s_or_none(v["solicitation"])
            and all(s_or_none(v[f"{k}_en"]) and s_or_none(v[f"{k}_fr"]) for k in BI_TEXT)
            and all(strs_or_none(v[f"{k}_en"]) and strs_or_none(v[f"{k}_fr"]) for k in BI_LISTS)
            and strs_or_none(v["regions_opportunity_en"]) and strs_or_none(v["end_users_en"])
            and s_or_none(v["published"]) and s_or_none(v["closing"]) and s_or_none(v["amended"])
            and s_or_none(v["start_expected"]) and s_or_none(v["end_expected"]) and s(v["status"])
            and s_or_none(v["gsin"]) and s_or_none(v["gsin_desc_en"]) and strs(v["category"]) and strs(v["provinces"])
            and buyer_or_none(v["buyer_id"]) and s(v["source_file"]) and s(v["first_seen"]) and s(v["last_seen"])
            and every(v["codes"], code_row)
            and every(v["amendments"], lambda a: num(a["amendment"]) and s_or_none(a["published"]) and s(a["first_seen"]))
            and every(v["related_awards"], lambda a: ref(a["reference"]) and org_or_none(a["organization_id"])
                      and num_or_none(a["value"]) and s_or_none(a["currency"])))


def contract_detail(v, kind, key):
    return (v["kind"] == kind and ref(v["reference"]) and v["reference"].lower() == key and num(v["amendment"])
            and all(s_or_none(v[f"{k}_en"]) and s_or_none(v[f"{k}_fr"]) for k in BI_TEXT)
            and all(strs_or_none(v[f"{k}_en"]) and strs_or_none(v[f"{k}_fr"]) for k in BI_LISTS)
            and num_or_none(v["amount"]) and num_or_none(v["total_value"]) and num_or_none(v["value"])
            and s(v["status"]) and strs(v["category"]) and competitive(v["competitive"]) and strs(v["provinces"])
            and org_or_none(v["organization_id"]) and s_or_none(v["supplier"]) and s_or_none(v["supplier_city"])
            and buyer_or_none(v["buyer_id"]) and buyer_or_none(v.get("client_id")) and s(v["source_file"])
            and s(v["first_seen"]) and every(v["codes"], code_row)
            and every(v["amendments"], lambda a: num(a["amendment"]) and num_or_none(a["amount"]))
            and (v.get("tender_reference") is None or ref(v["tender_reference"])))


def profile(p, oid):
    o = p["organization"]
    return (o["id"] == oid and s(o["display_name"]) and all(count(o[f"n_{k}"]) for k in (*MONEY, "lobbying"))
            and all(num_or_none(o[f"total_{k}"]) for k in MONEY)
            and every(p["names"], lambda n: s(n["name"]) and s(n["source"]) and count(n["n"]))
            and every(p["places"], lambda n: s_or_none(n["country"]) and s_or_none(n["city"]) and count(n["n"]))
            and every(p["registry"], lambda r: s(r["registry"]) and s(r["grade"]))
            and every(p["years"], year_figure)
            and every(p["awards"], award_row) and every(p["history"], award_row)
            and every(p["contracts"], contract_row) and every(p["grants"], grant_row) and every(p["lobbying"], lobby_row)
            and all(count(p[f"{k}_total_rows"]) for k in (*MONEY, "lobbying"))
            and every(p["buyers"], lambda b: b["source"] in MONEY and BUYER_ID.match(b["buyer_id"]) and count(b["n"]))
            and all(k in MONEY and count(n) for k, n in p.get("non_cad", {}).items())
            and ("expiring" not in p or expiring_part(p["expiring"])))


def published_ref(v):
    return v is None or (s(v) and 1 <= len(v) <= 200)


def expiring_row(r):
    reference_ok = (s(r["reference"]) and 0 < len(r["reference"]) <= 200) if r["kind"] == "contract" else ref(r["reference"])
    return (r["kind"] in ("award", "history", "contract") and reference_ok and published_ref(r.get("reference_published"))
            and s_or_none(r["title_en"]) and s_or_none(r["title_fr"]) and org_or_none(r["organization_id"])
            and s_or_none(r["organization"]) and isinstance(r.get("supplier_withheld", False), bool)
            and buyer_or_none(r["buyer_id"]) and s_or_none(r["buyer_en"]) and s_or_none(r["buyer_fr"])
            and s_or_none(r["start"]) and s(r["end"]) and re.match(r"^\d{4}-\d{2}-\d{2}", r["end"])
            and count(r["days_left"]) and num_or_none(r["value"]) and s_or_none(r["currency"])
            and competitive(r["competitive"]) and s_or_none(r["method_en"]) and s_or_none(r["method_fr"])
            and s_or_none(r["instrument_en"]) and s_or_none(r["instrument_fr"]) and count(r["n_amendments"])
            and num_or_none(r["value_growth"]) and (r.get("tender_reference") is None or ref(r["tender_reference"]))
            and strs(r["segments"]) and strs(r["provinces"]))


def expiring_part(v):
    return count(v["n"]) and num_or_none(v["total"]) and every(v["rows"], expiring_row) and len(v["rows"]) <= v["n"]


def test_every_file_passes_the_site_checks(exported):
    conn, out, ids, _ = exported
    stats = load(out, "stats.json")
    assert s(stats["data_as_of"]) and all(num(v) for v in stats["counts"].values())
    assert set(stats["counts"]) == {"organizations", "buyers", "tenders_open", "tenders_new_today",
                                    "tenders_closing_soon", "awards", "awards_year", "history", "contracts", "grants",
                                    "lobbying"}
    assert every(stats["new_tenders"], tender_row) and every(stats["closing_soon"], tender_row)
    assert every(stats["recent_awards"], award_row) and every(stats["top_organizations_year"], org_total)
    assert every(stats["runs"], lambda r: s(r["run_at"]) and s(r["source"]) and num_or_none(r["rows_new"]))
    assert every(stats["sources"], lambda r: s(r["source"]) and s(r["file"]))

    assert every(load(out, "tenders/open.json"), tender_row)
    first = load(out, "tenders/open-first.json")
    assert count(first["total"]) and every(first["rows"], tender_row) and len(first["rows"]) <= first["total"]
    assert set(first["facets"]) == {"category", "segment", "province", "buyer", "notice_type", "method"}
    assert all(every(v, lambda f: s(f["value"]) and count(f["n"])) for v in first["facets"].values())
    for path in (out / "tenders" / "new").glob("*.json"):
        assert every(json.loads(path.read_text(encoding="utf-8")), tender_row)
    for path in (out / "tenders").glob("*.json"):
        if path.name.startswith("open"):
            continue
        for key, v in json.loads(path.read_text(encoding="utf-8")).items():
            assert tender_detail(v, key), key
            assert es.reference_shard(key) == path.stem
    for path in (out / "contracts").glob("*.json"):
        for key, v in json.loads(path.read_text(encoding="utf-8")).items():
            kind, reference = key.split(":", 1)
            assert contract_detail(v, kind, reference), key
            assert es.reference_shard(reference) == path.stem
    assert every(load(out, "awards/recent.json"), award_row)
    for index in (out / "awards").glob("*/index.json"):
        meta = json.loads(index.read_text(encoding="utf-8"))
        assert meta["year"] == int(index.parent.name) and meta["rows"] >= meta["pages"]
        rows = [r for n in range(1, meta["pages"] + 1) for r in load(out, f"awards/{meta['year']}/{n}.json")]
        assert len(rows) == meta["rows"] and every(rows, award_row)
    for path in (out / "profiles").glob("*.json"):
        for oid, p in json.loads(path.read_text(encoding="utf-8")).items():
            assert oid[4:7] == path.stem and profile(p, oid), oid
    buyers = load(out, "buyers/index.json")["buyers"]
    assert buyers and all(BUYER_ID.match(b["id"]) and count(b["n_tenders"]) and num_or_none(b["total_awards"])
                          for b in buyers)
    for b in buyers:
        doc = load(out, f"buyers/{b['id']}.json")
        assert doc["buyer"]["id"] == b["id"] and count(doc["open_tenders"]) and every(doc["recent_awards"], award_row)
        assert every(doc["years"], lambda y: year_figure(y) and num_or_none(y["n_organizations"]))
        assert all(k in MONEY and every(v, org_total) for k, v in doc["top_organizations"].items())
    categories = load(out, "categories/index.json")
    assert categories["year"] == TODAY.year and len(categories["segments"]) == 57
    for c in categories["segments"]:
        doc = load(out, f"categories/{c['code']}.json")
        assert doc["code"] == c["code"] and every(doc["open_tenders"], tender_row)
        assert every(doc["top_organizations"], org_total)
        assert every(doc["years"], lambda y: isinstance(y["year"], int) and count(y["n"]) and num_or_none(y["total"]))
    for path in (out / "rankings").glob("*.json"):
        doc = json.loads(path.read_text(encoding="utf-8"))
        assert doc["year"] == (None if path.stem == "all" else int(path.stem))
        assert all(k in (*MONEY, "lobbying") and every(v["by_value"], org_total) and every(v["by_count"], org_total)
                   for k, v in doc["sources"].items())
        assert all(k in MONEY and every(v, lambda r: BUYER_ID.match(r["id"]) and count(r["n"]))
                   for k, v in doc["buyers"].items())
    radar = load(out, "expiring/index.json")
    assert s(radar["as_of"]) and [w["window"] for w in radar["windows"]] == ["3m", "6m", "12m"]
    assert all(count(w["n"]) and num_or_none(w["total"]) for w in radar["windows"])
    assert every(radar["by_buyer"], lambda b: buyer_or_none(b["buyer_id"]) and count(b["n"]) and num_or_none(b["total"]))
    assert every(radar["by_segment"], lambda g: re.match(r"^[0-9]{2}$", g["code"]) and count(g["n"]))
    for w in radar["windows"]:
        meta = load(out, f"expiring/{w['window']}/index.json")
        assert meta["window"] == w["window"] and meta["rows"] == w["n"] and meta["rows"] >= meta["pages"]
        rows = [r for n in range(1, meta["pages"] + 1) for r in load(out, f"expiring/{w['window']}/{n}.json")]
        assert len(rows) == meta["rows"] and every(rows, expiring_row)
        assert [r["end"] for r in rows] == sorted(r["end"] for r in rows)
    for b in buyers:
        assert expiring_part(load(out, f"buyers/{b['id']}.json")["expiring"])
    directories = load(out, "directory/index.json")["directories"]
    assert [d["code"] for d in directories] == es.directory.CODES
    for d in directories:
        part = load(out, f"directory/{d['code']}/index.json")
        assert part["pages"] == d["pages"] == len(part["ranges"]) and part["organizations"] == d["organizations"]
        for n in range(1, part["pages"] + 1):
            page = load(out, f"directory/{d['code']}/{n}.json")
            assert page["code"] == d["code"] and page["page"] == n and page["rows"]
            assert every(page["rows"], lambda r: ORG_ID.match(r["id"]) and s(r["name"]) and count(r["n_records"]))


def test_counts_and_home_lists(exported):
    conn, out, ids, _ = exported
    stats = load(out, "stats.json")
    assert stats["data_as_of"] == "2026-10-31"
    assert stats["counts"] == {"organizations": 3, "buyers": 2, "tenders_open": 4, "tenders_new_today": 2,
                               "tenders_closing_soon": 1, "awards": 6, "awards_year": 3, "history": 2, "contracts": 2,
                               "grants": 1, "lobbying": 1}
    # The year's count is the year's award pages' row count.
    assert stats["counts"]["awards_year"] == load(out, "awards/2026/index.json")["rows"]
    assert [r["reference"] for r in stats["closing_soon"]] == ["cb-200-2"]
    # The backlog notice was first seen today but published in 2024: not news.
    assert sorted(r["reference"] for r in stats["new_tenders"]) == ["SSC-26-00035339-T", "cb-200-2"]
    assert [r["id"] for r in stats["top_organizations_year"]] == [ids[ACME], ids[NORTH]]
    assert stats["top_organizations_year"][0]["total"] == 1_250_000.0


def test_stats_list_the_newest_runs_and_the_files_read(conn, tmp_path):
    seed(conn)
    log_run(conn, "awards", detail="read=x.csv", rows_new=3)
    conn.execute("INSERT INTO meta (key, value) VALUES ('canadabuys:2026-2027-awardNotice-avisAttribution.csv:read_at', "
                 "'2026-10-31T00:10:00Z'), ('contracts:last_modified', 'Fri, 30 Oct 2026 02:00:00 GMT')")
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    stats = load(out, "stats.json")
    assert stats["runs"][0]["source"] == "awards" and stats["runs"][0]["rows_new"] == 3
    assert stats["sources"] == [
        {"source": "awards", "file": "2026-2027-awardNotice-avisAttribution.csv", "last_read": "2026-10-31T00:10:00Z",
         "last_modified": None},
        {"source": "contracts", "file": "contracts.csv", "last_read": None,
         "last_modified": "Fri, 30 Oct 2026 02:00:00 GMT"},
    ]


def test_the_shard_rule_is_sha1_of_the_lowercase_url_reference(exported):
    _, out, _, _ = exported
    for published, url in ((SLASH_REF, "23240-220799-001-IM"), (COLON_REF, "SSC-26-00035339-T")):
        assert es.url_reference(published) == url
    assert es.url_reference("PW-$$XL-123-45678") == "PW-XL-123-45678"
    assert es.url_reference("$$") is None
    key = "ssc-26-00035339-t"
    assert es.reference_shard("SSC-26-00035339-T") == hashlib.sha1(key.encode()).hexdigest()[:3]
    shard = load(out, f"tenders/{es.reference_shard(key)}.json")
    assert shard[key]["reference"] == "SSC-26-00035339-T" and shard[key]["reference_published"] == COLON_REF
    award = load(out, f"contracts/{es.reference_shard('23240-220799-001-im')}.json")["award:23240-220799-001-im"]
    assert award["reference_published"] == SLASH_REF and award["kind"] == "award"
    history = load(out, f"contracts/{es.reference_shard('h-1')}.json")["history:h-1"]
    assert history["client_id"] == "dnd-mdn" and history["buyer_id"] == "pwgsc-tpsgc" and history["supplier"] == ACME
    # Award and history entries with the same reference share a shard and keep apart by prefix.
    assert es.reference_shard("aw-1") == hashlib.sha1(b"aw-1").hexdigest()[:3]


def test_a_tender_detail_has_its_versions_codes_and_related_awards(exported):
    _, out, ids, _ = exported
    d = load(out, f"tenders/{es.reference_shard('cb-100-1')}.json")["cb-100-1"]
    assert d["amendment"] == 1 and [a["amendment"] for a in d["amendments"]] == [0, 1]
    assert d["first_seen"] == "2026-10-29" and d["title_en"] == "Translation services, amended"
    assert [c["code"] for c in d["codes"]] == ["81111500", "8211"] and d["gsin"] == "N7030"
    # Solicitation numbers match whatever their case.
    assert [(a["reference"], a["organization_id"]) for a in d["related_awards"]] == [("AW-2", ids[NORTH])]
    contract = load(out, f"contracts/{es.reference_shard('aw-2')}.json")["award:aw-2"]
    assert contract["tender_reference"] == "cb-100-1"


def test_a_withheld_supplier_is_null_flagged_and_linked_to_nothing(exported):
    _, out, _, _ = exported
    d = load(out, f"contracts/{es.reference_shard('aw-5')}.json")["award:aw-5"]
    assert d["supplier"] is None and d["supplier_withheld"] is True and d["organization_id"] is None
    assert d["supplier_city"] is None
    h = load(out, f"contracts/{es.reference_shard('h-2')}.json")["history:h-2"]
    assert h["supplier"] is None and h["supplier_withheld"] is True and h["supplier_operating"] is None
    row = next(r for r in load(out, "awards/recent.json") if r["reference"] == "AW-5")
    assert row["organization_id"] is None and row["organization"] is None and row["supplier_withheld"] is True


def test_nothing_private_leaves_the_database(exported):
    _, out, _, _ = exported
    text = "\n".join(p.read_text(encoding="utf-8") for p in out.rglob("*") if p.is_file())
    for secret in (PERSON, PERSON_STREET, CONTACT_NAME, CONTACT_EMAIL, CONTACT_PHONE, SERVANT, SUPPLIER_STREET,
                   SUPPLIER_POSTAL):
        assert secret not in text, secret
    for field in ("contact_name", "contact_email", "contact_phone", "buyer_name_raw", "supplier_street",
                  "supplier_postal", "vendor_postal"):
        assert f'"{field}"' not in text, field


def test_counting_rules_on_rows_and_profiles(exported):
    _, out, ids, _ = exported
    profiles = {}
    for path in (out / "profiles").glob("*.json"):
        profiles.update(json.loads(path.read_text(encoding="utf-8")))
    acme, north, foreign = profiles[ids[ACME]], profiles[ids[NORTH]], profiles[ids[FOREIGN]]
    # The newest amendment's total value, one row per contract.
    aw1 = next(r for r in acme["awards"] if r["reference"] == "AW-1")
    assert aw1["value"] == 1_250_000.0 and aw1["competitive"] is False and acme["awards_total_rows"] == 2
    # A cancelled contract shows and counts zero.
    assert next(r for r in north["awards"] if r["reference"] == "AW-3")["value"] == 0
    # A contract in another currency is shown in it and left out of the totals.
    assert foreign["awards"][0]["currency"] == "EUR" and foreign["non_cad"] == {"awards": 1}
    assert foreign["organization"]["total_awards"] is None
    # Published contracts: the row's own value, the group's largest beside it.
    by_ref = {r["reference"]: r for r in north["contracts"]}
    assert by_ref["C-2"]["value"] == 30_000.0 and by_ref["C-2"]["value_last_reported"] == 130_000.0
    assert by_ref["C-1"]["value"] == 100_000.0
    # Grants: one agreement at its highest amendment.
    assert [(g["amendment"], g["value"]) for g in north["grants"]] == [(1, 15_000.0)]
    assert acme["lobbying"][0]["dpoh"][0]["title"] == "Deputy Minister" and acme["lobbying_total_rows"] == 1
    assert {(b["source"], b["buyer_id"]) for b in acme["buyers"]} >= {("awards", "dnd-mdn"), ("history", "dnd-mdn")}
    assert any(y["source"] == "awards" and y["year"] == 2026 for y in acme["years"])


def test_open_first_counts_every_open_notice_and_award_years_are_paged(conn, tmp_path, monkeypatch):
    seed(conn)
    monkeypatch.setattr(es, "OPEN_FIRST_ROWS", 1)
    monkeypatch.setattr(es, "HOME_ROWS", 0)
    monkeypatch.setattr(es, "AWARD_PAGE", 2)
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    first = load(out, "tenders/open-first.json")
    assert first["total"] == 4 and [r["reference"] for r in first["rows"]] == ["cb-200-2"]
    assert {f["value"]: f["n"] for f in first["facets"]["segment"]} == {"81": 2, "82": 1, "72": 1, "43": 1}
    assert first["facets"]["buyer"][0] == {"value": "pwgsc-tpsgc", "n": 3,
                                           "en": "Public Services and Procurement Canada",
                                           "fr": "Services publics et Approvisionnement Canada"}
    assert load(out, "awards/2026/index.json") == {"year": 2026, "pages": 2, "rows": 3}
    assert [r["awarded"] for r in load(out, "awards/2026/1.json")] == ["2026-10-20", "2026-08-08"]
    assert [r["reference"] for r in load(out, "awards/2026/2.json")] == ["AW-1"]
    assert not (out / "awards" / "2026.json").exists()
    # The closing-soon count covers every open notice, not the home page's list.
    stats = load(out, "stats.json")
    assert stats["closing_soon"] == [] and stats["counts"]["tenders_closing_soon"] == 1


def test_the_export_is_deterministic(conn, tmp_path):
    seed(conn)
    a, b = tmp_path / "a", tmp_path / "b"
    es.export_static(conn, a, today=TODAY, base_url=BASE)
    es.export_static(conn, b, today=TODAY, base_url=BASE)
    files_a = {p.relative_to(a).as_posix(): p.read_bytes() for p in a.rglob("*") if p.is_file()}
    files_b = {p.relative_to(b).as_posix(): p.read_bytes() for p in b.rglob("*") if p.is_file()}
    assert set(files_a) == set(files_b)
    # stats.json lists the runs, and the first export is one of them.
    assert [k for k in files_a if files_a[k] != files_b[k]] == ["stats.json"]


def test_the_file_count_and_size_checks_are_logged(conn, tmp_path, monkeypatch, caplog):
    seed(conn)
    monkeypatch.setattr(es, "MAX_FILES", 10)
    monkeypatch.setattr(es, "MAX_FILE_BYTES", 1000)
    monkeypatch.setattr(es, "PROFILE_SHARD_WARN", 100)
    with caplog.at_level(logging.WARNING, logger="awardwatch_pipeline.export_static"):
        counts = es.export_static(conn, tmp_path / "static", today=TODAY, base_url=BASE)
    assert counts["files"] > 10 and counts["profile_shards_over_300kb"] >= 1
    row = conn.execute("SELECT ok, notice FROM sources_log WHERE source = 'export' ORDER BY id DESC").fetchone()
    assert row["ok"] == 1 and f"{counts['files']} files (limit 10)" in row["notice"] and "over 25 MiB" in row["notice"]
    assert any("profile shards above" in r.message for r in caplog.records)
    size = es.tree_size(tmp_path / "static")
    assert size["files"] == counts["files"] and len(size["largest"]) == 5 and size["over_cap"]


def test_a_failing_section_is_logged_and_left_out_of_the_sitemap(conn, tmp_path, monkeypatch):
    seed(conn)

    def broken(*args, **kwargs):
        raise RuntimeError("bad buyer")

    monkeypatch.setattr(es, "write_buyers", broken)
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    failed = conn.execute("SELECT source, ok, detail FROM sources_log WHERE ok = 0").fetchall()
    assert [tuple(r) for r in failed] == [("export_buyers", 0, "RuntimeError: bad buyer")]
    assert not (out / "buyers").exists() and (out / "categories" / "index.json").exists()
    sitemap = (out / "sitemaps" / "sitemap-1.xml").read_text(encoding="utf-8")
    assert "/buyers" not in sitemap and f"{BASE}/categories</loc>" in sitemap


def test_an_empty_database_exports_a_tree_the_checks_accept(tmp_path):
    conn = connect(memory=True)
    out = tmp_path / "static"
    counts = es.export_static(conn, out, today=TODAY, base_url=BASE)
    assert load(out, "stats.json")["counts"]["organizations"] == 0
    assert load(out, "tenders/open.json") == [] and (out / "sitemaps" / "index.xml").exists()
    assert counts["files"] > 0


FREE_TEXT = re.compile(r"^(title|description|comments|program|selection|limited_reason)_(en|fr)$")


def free_text(obj, key=None):
    """Every (key, string) of a JSON value whose key names a free-text field, at any depth."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and FREE_TEXT.match(k):
                yield k, v
            else:
                yield from free_text(v, k)
    elif isinstance(obj, list):
        for v in obj:
            yield from free_text(v, key)


def test_contact_details_in_the_publishers_prose_never_reach_a_file(exported):
    _, out, _, _ = exported
    seen = []
    for path in out.rglob("*.json"):
        for key, value in free_text(json.loads(path.read_text(encoding="utf-8"))):
            assert "@" not in value and not re.search(r"\d{10}", value), (path.name, key, value)
            seen.append((key, value))
    # The placeholder is in the field's own language.
    assert any(k.endswith("_en") and "[contact removed]" in v for k, v in seen)
    assert any(k.endswith("_fr") and "[coordonnées retirées]" in v for k, v in seen)
    assert not any("[coordonnées retirées]" in v for k, v in seen if k.endswith("_en"))
    text = "\n".join(p.read_text(encoding="utf-8") for p in out.rglob("*") if p.is_file())
    for secret in (PROSE_EMAIL, *PROSE_PHONES):
        assert secret not in text, secret


def test_the_radar_lists_each_contract_once_by_window_with_its_parts(exported):
    _, out, ids, _ = exported
    radar = load(out, "expiring/index.json")
    assert [(w["window"], w["n"], w["total"]) for w in radar["windows"]] == [
        ("3m", 3, 562_000.0), ("6m", 5, 697_000.0), ("12m", 6, 1_947_000.0)]
    rows = load(out, "expiring/12m/1.json")
    assert [(r["kind"], r["reference"], r["days_left"]) for r in rows] == [
        ("award", "AW-5", 30), ("award", "AW-2", 45), ("history", "H-1", 81),
        ("award", "23240-220799-001-IM", 93), ("contract", "dnd-mdn:C-2", 151), ("award", "AW-1", 242)]
    by_ref = {r["reference"]: r for r in rows}
    assert by_ref["AW-5"]["organization_id"] is None and by_ref["AW-5"]["supplier_withheld"] is True
    assert by_ref["AW-2"]["tender_reference"] == "cb-100-1" and by_ref["AW-2"]["organization_id"] == ids[NORTH]
    assert by_ref["23240-220799-001-IM"]["reference_published"] == SLASH_REF
    assert (by_ref["AW-1"]["n_amendments"], by_ref["AW-1"]["value_growth"]) == (1, 0.25)
    contract = by_ref["dnd-mdn:C-2"]
    assert (contract["value"], contract["value_growth"], contract["n_amendments"]) == (130_000.0, 0.3, 1)
    assert contract["instrument_en"] == "Contract" and contract["tender_reference"] is None
    assert by_ref["H-1"]["buyer_id"] == "dnd-mdn"
    assert {b["buyer_id"]: b["n"] for b in radar["by_buyer"]} == {"dnd-mdn": 3, "pwgsc-tpsgc": 3}
    dnd = load(out, "buyers/dnd-mdn.json")["expiring"]
    assert dnd["n"] == 3 and [r["reference"] for r in dnd["rows"]] == ["H-1", "dnd-mdn:C-2", "AW-1"]
    profiles = {}
    for path in (out / "profiles").glob("*.json"):
        profiles.update(json.loads(path.read_text(encoding="utf-8")))
    acme = profiles[ids[ACME]]["expiring"]
    assert acme["n"] == 3 and acme["total"] == 300_000.0 + 5_000.0 + 1_250_000.0
    assert profiles[ids[FOREIGN]]["expiring"] == {"n": 0, "total": None, "rows": []}
    sitemap = (out / "sitemaps" / "sitemap-1.xml").read_text(encoding="utf-8")
    for path in ("/expiring", "/expiring/3m", "/expiring/6m", "/expiring/12m"):
        assert f"<loc>{BASE}{path}</loc>" in sitemap
