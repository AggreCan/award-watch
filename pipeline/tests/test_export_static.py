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
from awardwatch_pipeline import indicators
from awardwatch_pipeline.db import connect, log_run
from export_seed import (ACME, COLON_REF, CONTACT_EMAIL, CONTACT_NAME, CONTACT_PHONE, FOREIGN, NORTH, PERSON,
                         PERSON_STREET, PROSE_EMAIL, PROSE_PHONES, SERVANT, SLASH_REF, SUPPLIER_POSTAL, SUPPLIER_STREET,
                         TODAY, award, seed, tender)

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
                      and num_or_none(a["value"]) and s_or_none(a["currency"]))
            and ("attachments" not in v or every(v["attachments"], attachment))
            and ("description_cut" not in v or description_cut(v["description_cut"])))


def attachment(a):
    return isinstance(a, dict) and s(a.get("url")) and a["url"].startswith("https://") and s(a.get("name")) and a["name"]


def description_cut(c):
    # site/src/pages/shared.tsx descriptionCut: a language's figure is a whole number of characters above zero.
    return isinstance(c, dict) and set(c) <= {"en", "fr"} and all(count(n) and n > 0 for n in c.values())


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
            and (v.get("tender_reference") is None or ref(v["tender_reference"]))
            and ("description_cut" not in v or description_cut(v["description_cut"])))


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
                                    "tenders_closing_soon", "awards", "awards_year", "awards_erroneous", "history",
                                    "contracts", "grants", "lobbying", "awards_30d", "awards_year_suppliers"}
    assert all(num_or_none(v) for v in stats["totals"].values())
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
    # The site's isErroneousAward: a list row with the publication date and the contract's dates beside it.
    assert every(load(out, "awards/erroneous.json"), lambda r: award_row(r) and s_or_none(r["published"])
                 and s_or_none(r["start"]) and s_or_none(r["end"]))
    for index in (out / "awards").glob("*/index.json"):
        meta = json.loads(index.read_text(encoding="utf-8"))
        assert meta["year"] == int(index.parent.name) and meta["rows"] >= meta["pages"]
        rows = [r for n in range(1, meta["pages"] + 1) for r in load(out, f"awards/{meta['year']}/{n}.json")]
        assert len(rows) == meta["rows"] and every(rows, award_row)
        # The value set: the same rows, as many files or one more, the valued ones first.
        assert meta["pages"] <= meta["value_pages"] <= meta["pages"] + 1 and meta["valued_pages"] <= meta["value_pages"]
        by_value = [r for n in range(1, meta["value_pages"] + 1) for r in load(out, f"awards/{meta['year']}/value/{n}.json")]
        assert every(by_value, award_row) and sorted(map(json.dumps, by_value)) == sorted(map(json.dumps, rows))
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
                               "tenders_closing_soon": 1, "awards": 6, "awards_year": 3, "awards_erroneous": 0,
                               "history": 2, "contracts": 2, "grants": 1, "lobbying": 1, "awards_30d": 1,
                               "awards_year_suppliers": 2}
    # The year's count is the year's award pages' row count.
    assert stats["counts"]["awards_year"] == load(out, "awards/2026/index.json")["rows"]
    assert [r["reference"] for r in stats["closing_soon"]] == ["cb-200-2"]
    # The backlog notice was first seen today but published in 2024: not news.
    assert sorted(r["reference"] for r in stats["new_tenders"]) == ["SSC-26-00035339-T", "cb-200-2"]
    assert [r["id"] for r in stats["top_organizations_year"]] == [ids[ACME], ids[NORTH]]
    assert stats["top_organizations_year"][0]["total"] == 1_250_000.0


def test_stats_carry_the_years_award_value_and_each_download_with_its_size_and_rows(conn, tmp_path):
    """The home page's value beside the year's award notices, and the Data page's sizes and row counts: the CSV
    export's own files, as it wrote them; an export with no CSV folder lists none."""
    from awardwatch_pipeline import export
    ids = seed(conn)
    csv_dir = tmp_path / "csv"
    written = export.export_csv(conn, csv_dir, today=TODAY)
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE, csv_dir=csv_dir)
    stats = load(out, "stats.json")
    # The seed's three award notices of 2026: ACME's and North's, ranked, and one whose supplier is withheld,
    # which no ranking names but the year's value counts.
    assert stats["totals"]["awards_year"] == 1_250_000.0 + 250_000.0 + 12_000.0
    # Of those, North's of 2026-10-20 is the one awarded in the 30 days to the data date.
    assert stats["totals"]["awards_30d"] == 250_000.0
    assert [o["id"] for o in stats["top_organizations_year"]] == [ids[ACME], ids[NORTH]]
    downloads = {d["file"]: d for d in stats["downloads"]}
    assert set(downloads) == set(written)
    for name, d in downloads.items():
        assert d["bytes"] == (csv_dir / name).stat().st_size
        assert d["rows"] == written[name], name
    # SHA256SUMS: one line a CSV file.
    assert downloads["SHA256SUMS"]["rows"] == len(written) - 1
    # The counts export_csv returned are used as given; a file they leave out is read.
    es.export_static(conn, out, today=TODAY, base_url=BASE, csv_dir=csv_dir, csv_rows={"organizations.csv": 999})
    again = {d["file"]: d for d in load(out, "stats.json")["downloads"]}
    assert again["organizations.csv"]["rows"] == 999 and again["buyers.csv"]["rows"] == written["buyers.csv"]
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    assert load(out, "stats.json")["downloads"] == []


def test_the_home_pages_award_notices_are_the_newest_by_award_date(conn, tmp_path):
    """stats.json recent_awards, which the home page lists in its Awarded column's order: the newest award dates,
    so a notice published today for a contract awarded months ago does not stand above this week's awards. A date
    after the data date (a typing error) and a notice with no award date are left out; the award pages keep them."""
    seed(conn)
    award(conn, "AW-LATE-PUB", 0, ACME, value=5.0, awarded="2025-01-10", published="2026-10-31")
    award(conn, "AW-FUTURE", 0, ACME, value=5.0, awarded="2029-01-01", published="2026-10-30")
    award(conn, "AW-UNDATED", 0, ACME, value=5.0, awarded=None, published="2026-10-31")
    award(conn, "AW-TODAY", 0, NORTH, value=5.0, awarded="2026-10-31", published="2026-10-31")
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    recent = load(out, "stats.json")["recent_awards"]
    awarded = [r["awarded"] for r in recent]
    assert awarded == sorted(awarded, reverse=True) and recent[0]["reference"] == "AW-TODAY"
    refs = [r["reference"] for r in recent]
    assert "AW-FUTURE" not in refs and "AW-UNDATED" not in refs
    # Published today, awarded on 2025-01-10: after the seed's notices awarded since (AW-4, 2025-02-01), before
    # the one of 2024; by publication date it would have stood first.
    assert refs.index("AW-4") < refs.index("AW-LATE-PUB") < refs.index(SLASH_REF.replace("/", "-"))
    assert len(recent) <= es.HOME_ROWS


def test_an_award_date_after_the_data_date_leaves_the_newest_lists_and_is_listed_apart(conn, tmp_path):
    """The contract's end date typed in the award-date field (cb-502-17330425: awarded 2029-08-31, start 2026-09-01,
    end 2029-08-31). The newest lists leave it out and awards/erroneous.json holds it with its dates; the year
    pages, the profile and the tender's related awards keep it, the last two at its publication date. An award date
    up to the data date is left alone, even one after the publication date."""
    ids = seed(conn)
    award(conn, "AW-FUTURE", 0, NORTH, value=80_000.0, awarded="2029-08-31", published="2026-08-31",
          solicitation="sol-1")
    award(conn, "AW-DEC", 0, ACME, value=9_000.0, awarded="2026-12-15", published="2026-10-01")
    award(conn, "AW-EDGE", 0, ACME, value=7_000.0, awarded="2026-10-31", published="2026-10-29")
    conn.execute('UPDATE awards SET start = ?, "end" = ? WHERE reference = ?', ("2026-09-01", "2029-08-31", "AW-FUTURE"))
    conn.execute('UPDATE awards SET "end" = ? WHERE reference = ?', ("2026-12-15", "AW-DEC"))
    # A PSPC history record dated the same way, for the profile's other list.
    conn.execute(
        "INSERT INTO contract_history (reference, amendment, title_en, awarded, published, amount, total_value, currency, "
        "status, supplier_raw, organization_id, buyer_id, client_id, source_file, first_seen, last_seen) VALUES "
        "('H-FUTURE', 0, 'Boots, later', '2028-03-31', '2026-05-01', 1000, 1000, 'CAD', 'active', ?, ?, 'pwgsc-tpsgc', "
        "'dnd-mdn', 'history.csv', '2026-10-31', '2026-10-31')", (ACME, ids[ACME]))
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)

    recent = [r["reference"] for r in load(out, "awards/recent.json")]
    assert "AW-FUTURE" not in recent and "AW-DEC" not in recent and "AW-EDGE" in recent
    buyer = [r["reference"] for r in load(out, "buyers/pwgsc-tpsgc.json")["recent_awards"]]
    assert "AW-FUTURE" not in buyer and "AW-DEC" not in buyer and "AW-EDGE" in buyer
    # The year pages: 2026 keeps December's; no page for 2029, a year after the data date's.
    year = load(out, "awards/2026/1.json")
    assert "AW-DEC" in [r["reference"] for r in year] and not (out / "awards" / "2029").exists()

    erroneous = load(out, "awards/erroneous.json")
    assert [r["reference"] for r in erroneous] == ["AW-FUTURE", "AW-DEC"]
    first = erroneous[0]
    assert (first["awarded"], first["published"], first["start"], first["end"]) == (
        "2029-08-31", "2026-08-31", "2026-09-01", "2029-08-31")
    assert first["organization_id"] == ids[NORTH] and first["value"] == 80_000.0
    assert load(out, "stats.json")["counts"]["awards_erroneous"] == 2

    # The profile keeps it, placed by its publication date, its award date as published: North's AW-2 was awarded
    # 2026-10-20, AW-FUTURE published 2026-08-31, AW-3 awarded 2025-05-05.
    north = load(out, f"profiles/{ids[NORTH][4:7]}.json")[ids[NORTH]]
    assert [r["reference"] for r in north["awards"]] == ["AW-2", "AW-FUTURE", "AW-3"]
    assert north["awards"][1]["awarded"] == "2029-08-31"
    acme = load(out, f"profiles/{ids[ACME][4:7]}.json")[ids[ACME]]
    assert [r["reference"] for r in acme["awards"]][:3] == ["AW-EDGE", "AW-DEC", "AW-1"]
    # H-1 awarded 2026-06-01 stands before H-FUTURE, published 2026-05-01.
    assert [r["reference"] for r in acme["history"]] == ["H-1", "H-FUTURE"]

    # The tender with solicitation SOL-1: AW-2 (awarded 2026-10-20) before AW-FUTURE (published 2026-08-31).
    shard = load(out, f"tenders/{es.reference_shard('cb-100-1')}.json")
    assert [a["reference"] for a in shard["cb-100-1"]["related_awards"]] == ["AW-2", "AW-FUTURE"]


def test_each_year_is_also_written_by_value_with_the_rows_without_one_last(conn, tmp_path, monkeypatch):
    """awards/<year>/value/<n>.json: the year's rows, those with a value in Canadian dollars (or no stated
    currency) largest first, equal values in award date order; then, from a file of their own, those without one
    (none published, or another currency) in award date order. The index counts the set's files and the valued
    ones, so the site can read the smallest first and still keep the rows without a value last."""
    monkeypatch.setattr(es, "AWARD_PAGE", 2)
    seed(conn)
    # 2026 in the seed: AW-1 (1,250,000, March 2), AW-2 (250,000, October 20), AW-5 (12,000, August 8).
    award(conn, "AW-TIE", 0, ACME, value=12_000.0, awarded="2026-07-01")
    award(conn, "AW-NOVAL", 0, ACME, value=None, awarded="2026-05-01")
    award(conn, "AW-EURO26", 0, FOREIGN, value=5_000.0, currency="EUR", awarded="2026-04-01", country="DE", province="")
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)

    def refs(path):
        return [r["reference"] for r in load(out, path)]

    meta = load(out, "awards/2026/index.json")
    assert meta == {"year": 2026, "pages": 3, "rows": 6, "value_pages": 3, "valued_pages": 2}
    assert refs("awards/2026/1.json") + refs("awards/2026/2.json") + refs("awards/2026/3.json") == [
        "AW-2", "AW-5", "AW-TIE", "AW-NOVAL", "AW-EURO26", "AW-1"]
    assert [refs(f"awards/2026/value/{n}.json") for n in (1, 2, 3)] == [
        ["AW-1", "AW-2"], ["AW-5", "AW-TIE"], ["AW-NOVAL", "AW-EURO26"]]
    # 2025: AW-3, cancelled (a value of 0), and AW-4 in euros. The row without a value starts a file of its own,
    # so the set has one file more than the date set.
    assert load(out, "awards/2025/index.json") == {"year": 2025, "pages": 1, "rows": 2, "value_pages": 2, "valued_pages": 1}
    assert refs("awards/2025/1.json") == ["AW-3", "AW-4"]
    assert refs("awards/2025/value/1.json") == ["AW-3"] and refs("awards/2025/value/2.json") == ["AW-4"]
    # A year whose every row has a value has no file of rows without one.
    assert load(out, "awards/2024/index.json")["value_pages"] == load(out, "awards/2024/index.json")["valued_pages"] == 1


def test_the_award_day_is_built_only_from_a_date():
    assert es.award_day("2026-10-31") == "CASE WHEN substr(awarded, 1, 10) > '2026-10-31' THEN published ELSE awarded END"
    for bad in ("2026-10-31' OR 1=1 --", "", "2026-10-3", "2026-10-31T00:00:00"):
        with pytest.raises(ValueError):
            es.award_day(bad)


def test_stats_count_the_last_30_days_awards_and_the_years_suppliers(conn, tmp_path):
    """Beside the year's award notices on the home page: those awarded in the 30 days to the data date (the data
    date and the 29 before it), what they add up to by the counting rules, and the organizations the year's
    notices name, each once, a withheld supplier naming none."""
    seed(conn)
    # 2026-10-02 is the window's first day and 2026-10-01 the day before it; a date after the data date is not in
    # the last 30 days. A second notice to North adds a notice and no supplier; a euro value adds to no total.
    award(conn, "AW-30A", 0, NORTH, value=100_000.0, awarded="2026-10-02")
    award(conn, "AW-30B", 0, ACME, value=40_000.0, awarded="2026-10-01")
    award(conn, "AW-30C", 0, ACME, value=7_000.0, awarded="2026-11-05")
    award(conn, "AW-30D", 0, None, value=3_000.0, withheld=True, awarded="2026-10-31")
    award(conn, "AW-30E", 0, "EURO SUPPLIES GMBH", value=9_000.0, currency="EUR", awarded="2026-10-15", country="DE")
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    stats = load(out, "stats.json")
    # AW-2 (2026-10-20, 250,000), AW-30A, AW-30D and AW-30E.
    assert stats["counts"]["awards_30d"] == 4
    assert stats["totals"]["awards_30d"] == 250_000.0 + 100_000.0 + 3_000.0
    # ACME, North and the euro supplier; AW-5 and AW-30D withhold theirs.
    assert stats["counts"]["awards_year_suppliers"] == 3


def test_the_3_month_csv_holds_the_3_month_list_and_the_data_page_counts_it(conn, tmp_path):
    """expiring-3m.csv lists the contracts the site's 3-month list shows, in its order, and stats.json gives the
    Data page its rows as it does every other file's."""
    import csv
    from awardwatch_pipeline import export
    seed(conn)
    csv_dir = tmp_path / "csv"
    written = export.export_csv(conn, csv_dir, today=TODAY)
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE, csv_dir=csv_dir, csv_rows=written)
    shown = [r.get("reference_published", r["reference"]) for r in load(out, "expiring/3m/1.json")]
    with (csv_dir / "expiring-3m.csv").open(encoding="utf-8-sig", newline="") as fh:
        listed = [r["reference"] for r in csv.DictReader(fh)]
    assert listed == shown == ["AW-5", "AW-2", "H-1"]
    window = next(w for w in load(out, "expiring/index.json")["windows"] if w["window"] == "3m")
    downloads = {d["file"]: d for d in load(out, "stats.json")["downloads"]}
    assert downloads["expiring-3m.csv"]["rows"] == window["n"] == 3
    assert downloads["expiring-3m.csv"]["bytes"] == (csv_dir / "expiring-3m.csv").stat().st_size
    # The 6-month file holds the 6-month list's contracts and is counted the same way.
    six = next(w for w in load(out, "expiring/index.json")["windows"] if w["window"] == "6m")
    with (csv_dir / "expiring-6m.csv").open(encoding="utf-8-sig", newline="") as fh:
        listed_6m = [r["reference"] for r in csv.DictReader(fh)]
    shown_6m = [r.get("reference_published", r["reference"]) for r in load(out, "expiring/6m/1.json")]
    assert listed_6m == shown_6m and downloads["expiring-6m.csv"]["rows"] == six["n"] == len(listed_6m) == 5
    assert downloads["expiring-6m.csv"]["bytes"] == (csv_dir / "expiring-6m.csv").stat().st_size
    assert downloads["expiring-12m.csv"]["rows"] == 6


def test_a_csv_record_holding_a_line_break_counts_once(tmp_path):
    (tmp_path / "a.csv").write_text('\ufeffid,text\n1,"two\nlines"\n2,plain\n', encoding="utf-8")
    (tmp_path / "notes.txt").write_text("not a download", encoding="utf-8")
    assert es.download_files(tmp_path) == [{"file": "a.csv", "bytes": (tmp_path / "a.csv").stat().st_size, "rows": 2}]
    assert es.download_files(tmp_path / "missing") == []


def test_stats_list_the_newest_runs_and_the_files_read(conn, tmp_path):
    seed(conn)
    log_run(conn, "awards", detail="read=x.csv", rows_new=3)
    conn.execute("INSERT INTO meta (key, value) VALUES ('canadabuys:2026-2027-awardNotice-avisAttribution.csv:read_at', "
                 "'2026-10-31T00:10:00Z'), ('contracts:last_modified', 'Fri, 30 Oct 2026 02:00:00 GMT')")
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    stats = load(out, "stats.json")
    assert stats["runs"][0]["source"] == "awards" and stats["runs"][0]["rows_new"] == 3
    by_source = {r["source"]: r for r in stats["sources"]}
    assert by_source["awards"] == {
        "source": "awards", "file": "2026-2027-awardNotice-avisAttribution.csv", "last_read": "2026-10-31T00:10:00Z",
        "last_modified": None, "last_modified_http": None, "loaded": True}
    # A Last-Modified alone is not a read; the publisher's date travels as an ISO instant.
    assert by_source["contracts"] == {
        "source": "contracts", "file": "contracts.csv", "last_read": None, "last_modified": "2026-10-30T02:00:00Z",
        "last_modified_http": "Fri, 30 Oct 2026 02:00:00 GMT", "loaded": False}


def test_every_source_the_data_page_lists_has_a_row_with_its_real_last_read(conn, tmp_path):
    """The Data page read "Not read yet" for the CKAN organizations and the corporations registry, which
    are read every night: neither wrote a row. Each source now has one, with loaded false until a read."""
    seed(conn)
    conn.executemany("INSERT INTO meta (key, value) VALUES (?, ?)", [
        ("buyers_loaded_at", "2026-10-01T10:42:03Z"),
        ("registry:corporations-active-cbca-en.csv:read_at", "2026-10-31T18:47:00Z"),
        ("registry:corporations-active-cbca-en.csv:last_modified", "Sun, 01 Nov 2026 17:15:06 GMT"),
        ("registry:corporations-inactive-or-dissolved-cbca-en.csv:read_at", "2026-10-31T18:47:30Z"),
        ("canadabuys:openTenderNotice-ouvertAvisAppelOffres.csv:read_at", "2026-10-31T12:44:19Z"),
        ("canadabuys:openTenderNotice-ouvertAvisAppelOffres.csv:last_modified", "Sat, 31 Oct 2026 11:20:14 GMT"),
        ("lobbying:refused_on", "2026-10-31"),
    ])
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    rows = load(out, "stats.json")["sources"]
    assert [r["source"] for r in rows] == ["buyers", "tenders", "awards", "history", "contracts", "grants", "lobbying",
                                           "registry", "registry", "pa_services"]
    assert all(set(r) == {"source", "file", "last_read", "last_modified", "last_modified_http", "loaded"} for r in rows)
    assert all(r["loaded"] is (r["last_read"] is not None) for r in rows)
    buyers_row, tenders_row = rows[0], rows[1]
    assert buyers_row["file"] == "organization_show" and buyers_row["last_read"] == "2026-10-01T10:42:03Z"
    assert tenders_row["last_modified"] == "2026-10-31T11:20:14Z" and tenders_row["loaded"] is True
    registry = [r for r in rows if r["source"] == "registry"]
    assert [r["file"] for r in registry] == ["corporations-active-cbca-en.csv",
                                             "corporations-inactive-or-dissolved-cbca-en.csv"]
    assert registry[0]["last_modified"] == "2026-11-01T17:15:06Z" and registry[0]["loaded"] is True
    assert registry[0]["last_modified_http"] == "Sun, 01 Nov 2026 17:15:06 GMT"
    # A source never read (the registry of lobbyists refused the download) still has its row.
    lobbying = next(r for r in rows if r["source"] == "lobbying")
    assert lobbying == {"source": "lobbying", "file": "communications_ocl_cal.zip", "last_read": None,
                        "last_modified": None, "last_modified_http": None, "loaded": False}
    # The buyers stage's own read time wins over the refresh schedule's.
    conn.execute("INSERT INTO meta (key, value) VALUES ('buyers:read_at', '2026-10-31T10:42:03Z')")
    assert es.source_files(conn)[0]["last_read"] == "2026-10-31T10:42:03Z"


def test_http_dates_become_iso_instants():
    assert es.http_date_iso("Sun, 01 Nov 2026 17:15:06 GMT") == "2026-11-01T17:15:06Z"
    assert es.http_date_iso("Sun, 01 Nov 2026 12:15:06 -0500") == "2026-11-01T17:15:06Z"
    assert es.http_date_iso("") is None and es.http_date_iso("Sun, 01 No") is None and es.http_date_iso(None) is None


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


CB = "https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/"


def test_a_tender_detail_lists_its_documents_by_name(conn, tmp_path):
    seed(conn)
    # cb-100-1: the first version names two documents, the amendment none (the newest that names any stands);
    # COLON_REF: a link from another host, written into the database by hand, never reaches the file.
    conn.execute("UPDATE tenders SET attachments = ? WHERE reference = 'cb-100-1' AND amendment = 0", (json.dumps([
        f"{CB}111717/w8703-270117-rfp-demo-kit%2C-bangalore-torpedo-en.pdf",
        "https://sscp2pspc.ssc-spc.gc.ca/page.aspx/en/fil/download_public/359FE376-8B8E-4262-8BA7-FF84512C5F6C",
    ]),))
    conn.execute("UPDATE tenders SET attachments = ? WHERE reference = ?", (json.dumps([
        "https://example.com/elsewhere.pdf", f"{CB}2/a%20b.pdf", f"{CB}2/a%20b.pdf",
    ]), COLON_REF))
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    d = load(out, f"tenders/{es.reference_shard('cb-100-1')}.json")["cb-100-1"]
    assert d["amendment"] == 1 and tender_detail(d, "cb-100-1")
    assert d["attachments"] == [
        {"url": f"{CB}111717/w8703-270117-rfp-demo-kit%2C-bangalore-torpedo-en.pdf",
         "name": "w8703-270117-rfp-demo-kit,-bangalore-torpedo-en.pdf"},
        {"url": "https://sscp2pspc.ssc-spc.gc.ca/page.aspx/en/fil/download_public/359FE376-8B8E-4262-8BA7-FF84512C5F6C",
         "name": "359FE376-8B8E-4262-8BA7-FF84512C5F6C"},
    ]
    colon = load(out, f"tenders/{es.reference_shard('SSC-26-00035339-T')}.json")["ssc-26-00035339-t"]
    assert colon["attachments"] == [{"url": f"{CB}2/a%20b.pdf", "name": "a b.pdf"}]
    # A notice that names no document carries no key; the list rows never carry one.
    hull = load(out, f"tenders/{es.reference_shard('cb-200-2')}.json")["cb-200-2"]
    assert "attachments" not in hull and tender_detail(hull, "cb-200-2")
    assert all("attachments" not in r for r in load(out, "tenders/open.json"))
    text = "\n".join(p.read_text(encoding="utf-8") for p in out.rglob("*.json"))
    assert "example.com" not in text and CONTACT_EMAIL not in text


def test_a_documents_name_is_its_last_path_segment_decoded():
    assert es.attachment_name(f"{CB}111714/30008413---rfq-%28en_final.pdf") == "30008413---rfq-(en_final.pdf"
    assert es.attachment_name("https://canadabuys.canada.ca/docs/") == "docs"
    assert es.attachment_name("https://canadabuys.canada.ca") == "canadabuys.canada.ca"


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
    assert load(out, "awards/2026/index.json") == {"year": 2026, "pages": 2, "rows": 3, "value_pages": 2, "valued_pages": 2}
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
    assert "/buyers" not in sitemap and f"{BASE}/segments</loc>" in sitemap


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
    assert profiles[ids[FOREIGN]]["expiring"] == {"n": 0, "total": None, "n_no_value": 0, "rows": []}
    sitemap = (out / "sitemaps" / "sitemap-1.xml").read_text(encoding="utf-8")
    for path in ("/expiring", "/expiring/3m", "/expiring/6m", "/expiring/12m"):
        assert f"<loc>{BASE}{path}</loc>" in sitemap


# -- a notice the open-notice file still lists after its closing day ---------------------


def test_a_notice_past_its_closing_day_is_closed_and_left_out_of_every_open_list(conn, tmp_path):
    """CanadaBuys' open-notice file keeps some notices for months after they close; the export showed them as
    open. A notice whose closing day (UTC) is before the data date is closed; one closing on the data date is
    still open, the run being in the morning."""
    seed(conn)
    tender(conn, "cb-yesterday", 0, title="Closed yesterday", closing="2026-10-30T14:00:00", published="2026-10-29")
    tender(conn, "cb-today", 0, title="Closes today", closing="2026-10-31T14:00:00", published="2026-10-29")
    tender(conn, "cb-tomorrow", 0, title="Closes tomorrow", closing="2026-11-01T09:00:00", published="2026-10-29")
    tender(conn, "cb-2023", 0, title="Closed in 2023", closing="2023-07-12T10:00:00", published="2023-06-01",
           first_seen="2026-09-01")
    # A closing given with a zone is compared on its day in UTC: 19:00 in Vancouver on the 30th is the 31st.
    tender(conn, "cb-zoned", 0, title="Zoned", closing="2026-10-30T19:00:00-07:00", published="2026-10-29")
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)

    open_refs = [r["reference"] for r in load(out, "tenders/open.json")]
    assert "cb-today" in open_refs and "cb-tomorrow" in open_refs and "cb-zoned" in open_refs
    assert "cb-yesterday" not in open_refs and "cb-2023" not in open_refs
    first = load(out, "tenders/open-first.json")
    assert first["total"] == len(open_refs) == 7
    assert not {"cb-yesterday", "cb-2023"} & {r["reference"] for r in first["rows"]}
    stats = load(out, "stats.json")
    assert stats["counts"]["tenders_open"] == 7
    # Closing within the week from the data date: cb-200-2, today's, tomorrow's and the zoned one.
    assert stats["counts"]["tenders_closing_soon"] == 4
    assert {r["reference"] for r in stats["closing_soon"]} == {"cb-200-2", "cb-today", "cb-tomorrow", "cb-zoned"}

    detail = load(out, f"tenders/{es.reference_shard('cb-yesterday')}.json")["cb-yesterday"]
    assert detail["status"] == "closed" and detail["source_status"] == "open"
    assert [a["status"] for a in detail["amendments"]] == ["open"]
    assert load(out, f"tenders/{es.reference_shard('cb-today')}.json")["cb-today"]["status"] == "open"
    new = {r["reference"]: r for r in load(out, "tenders/new/2026-10-31.json")}
    assert new["cb-yesterday"]["status"] == "closed" and new["cb-yesterday"]["source_status"] == "open"
    assert new["cb-today"]["status"] == "open" and new["cb-today"]["source_status"] == "open"
    assert all(tender_row(r) for r in new.values())
    buyer = load(out, "buyers/pwgsc-tpsgc.json")
    assert buyer["open_tenders"] == 6 and buyer["buyer"]["n_open_tenders"] == 6


# -- buyers with nothing to show ------------------------------------------------------------


def test_a_buyer_with_nothing_in_any_column_is_left_out_and_a_person_is_never_a_buyer(conn, tmp_path):
    """/buyers listed 196 buyers with zero in every column (their only records closed tender notices, or
    none) and buyers named after people. A buyer is listed only with an open tender notice, an award notice,
    a contract history record, a published contract or a grant; its records keep their names without a link."""
    seed(conn)
    conn.execute("INSERT INTO buyers (id, name_en, name_fr, updated_at) VALUES ('closed-only', 'Closed Only Agency', "
                 "'Agence close', '2026-10-31')")
    tender(conn, "cb-closed", 0, title="Old notice", status="expired", closing="2026-01-10T14:00:00",
           published="2025-12-01", first_seen="2026-10-01", buyer="closed-only")
    # A notice whose buyer spelling was a person's name: no buyer, and the spelling is never printed.
    tender(conn, "cb-person", 0, title="Named contact", closing="2026-11-20T14:00:00", buyer=None)
    conn.execute("UPDATE tenders SET buyer_raw_en = 'Adam Cheung', buyer_raw_fr = 'Adam Cheung' "
                 "WHERE reference = 'cb-person'")
    tender(conn, "cb-government", 0, title="Generic buyer", closing="2026-11-20T14:00:00", buyer=None)
    conn.execute("UPDATE tenders SET buyer_raw_en = 'Government of Canada' WHERE reference = 'cb-government'")
    conn.commit()
    indicators.compute(conn, now="2026-10-31T01:00:00Z")
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)

    index = [b["id"] for b in load(out, "buyers/index.json")["buyers"]]
    assert index == ["dnd-mdn", "pwgsc-tpsgc"]
    assert not (out / "buyers" / "closed-only.json").exists() and not (out / "buyers" / "never-buys.json").exists()
    assert load(out, "stats.json")["counts"]["buyers"] == 2
    for path in (out / "rankings").glob("*.json"):
        assert all(r["id"] in index for rows in load(out, f"rankings/{path.name}")["buyers"].values() for r in rows)
    sitemap = (out / "sitemaps" / "sitemap-1.xml").read_text(encoding="utf-8")
    assert "/buyers/closed-only" not in sitemap and "/buyers/pwgsc-tpsgc" in sitemap

    details = {}
    for ref_ in ("cb-closed", "cb-person", "cb-government"):
        details[ref_] = load(out, f"tenders/{es.reference_shard(ref_)}.json")[ref_]
    # The unlisted buyer's notice keeps the buyer's name, with no link to a page that does not exist.
    assert details["cb-closed"]["buyer_id"] is None and details["cb-closed"]["buyer_en"] == "Closed Only Agency"
    assert details["cb-person"]["buyer_id"] is None and details["cb-person"]["buyer_en"] is None
    assert details["cb-government"]["buyer_en"] == "Government of Canada"
    text = "".join(p.read_text(encoding="utf-8") for p in out.rglob("*") if p.is_file())
    assert "Adam Cheung" not in text



def test_retired_buyer_ids_are_exported_as_aliases_to_listed_buyers(conn, tmp_path):
    seed(conn)
    conn.executemany("INSERT INTO buyer_aliases (old_id, new_id, reason, updated_at) VALUES (?, ?, ?, ?)", [
        ("public-works-and-government-services-canada", "pwgsc-tpsgc", "merged", "2026-10-31T00:00:00Z"),
        ("department-of-national-defence", "dnd-mdn", "merged", "2026-10-31T00:00:00Z"),
        # A target with nothing to show has no page to send anyone to.
        ("old-never-buys", "never-buys", "merged", "2026-10-31T00:00:00Z"),
    ])
    conn.commit()
    out = tmp_path / "static"
    counts = es.export_static(conn, out, today=TODAY, base_url=BASE)
    assert load(out, "buyers/aliases.json") == {"aliases": {
        "department-of-national-defence": "dnd-mdn", "public-works-and-government-services-canada": "pwgsc-tpsgc"}}
    assert counts["buyer_aliases"] == 2
    assert all(BUYER_ID.match(k) and BUYER_ID.match(v) for k, v in load(out, "buyers/aliases.json")["aliases"].items())


# -- closing times read at render ---------------------------------------------------------


def test_open_first_holds_the_notices_that_can_close_before_the_next_nightly(conn, tmp_path, monkeypatch):
    """The site reads closing times at render and sorts a notice whose time has passed last; open-first.json
    holds every notice closing by the day after the data date and OPEN_FIRST_ROWS after them, so the first page
    stays full. stats.json carries every closing value within CLOSING_TIMES_DAYS for the counts."""
    seed(conn)
    for i in range(3):
        tender(conn, f"cb-early-{i}", 0, title=f"Closes today {i}", closing="2026-10-31T14:00:00", published="2026-10-29")
    tender(conn, "cb-next-day", 0, title="Closes tomorrow", closing="2026-11-01T09:00:00", published="2026-10-29")
    tender(conn, "cb-far", 0, title="Closes in a month", closing="2026-12-01T14:00:00", published="2026-10-29")
    tender(conn, "cb-day-9", 0, title="Closes on day 9", closing="2026-11-09", published="2026-10-29")
    tender(conn, "cb-day-10", 0, title="Closes on day 10", closing="2026-11-10T14:00:00", published="2026-10-29")
    conn.commit()
    monkeypatch.setattr(es, "OPEN_FIRST_ROWS", 2)
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    open_rows = load(out, "tenders/open.json")
    first = load(out, "tenders/open-first.json")
    early = [r["reference"] for r in open_rows if r["closing"][:10] <= "2026-11-01"]
    assert set(early) == {"cb-early-0", "cb-early-1", "cb-early-2", "cb-next-day"}
    assert [r["reference"] for r in first["rows"]] == [r["reference"] for r in open_rows[:len(early) + 2]]
    stats = load(out, "stats.json")
    times = stats["closing_soon_times"]
    assert times == [r["closing"] for r in open_rows if "2026-10-31" <= r["closing"][:10] <= "2026-11-09"]
    assert "2026-11-09" in times and "2026-11-10T14:00:00" not in times and "2026-12-01T14:00:00" not in times
    assert times.count("2026-10-31T14:00:00") == 3


def test_the_open_list_carries_a_scrubbed_excerpt_and_the_full_codes_and_nothing_else_does(conn, tmp_path):
    """The list page's word filter reads the start of each description and its code filter the full UNSPSC
    codes; both ride on tenders/open.json and open-first.json only. The excerpt is scrubbed before it is cut,
    so a cut never leaves part of an address or a telephone number the scrub would miss."""
    seed(conn)
    long = ("Snow clearing for the regional depot. " * 4) + "Questions to jane.officer@example.gc.ca or 613-555-0142 "
    tender(conn, "cb-words", 0, title="Snow clearing", closing="2026-11-03T14:00:00", codes=("72102900", "7210"))
    conn.execute("UPDATE tenders SET description_en = ?, description_fr = ? WHERE reference = 'cb-words'",
                 (long + "before the closing date.", "Déneigement du dépôt régional."))
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    row = next(r for r in load(out, "tenders/open.json") if r["reference"] == "cb-words")
    assert row["excerpt_fr"] == "Déneigement du dépôt régional."
    assert len(row["excerpt_en"]) <= es.EXCERPT_CHARS + 1 and row["excerpt_en"].endswith("…")
    assert "jane.officer" not in row["excerpt_en"] and "613-555" not in row["excerpt_en"]
    assert row["codes"] == ["7210", "72102900"]
    assert any("excerpt_en" in r for r in load(out, "tenders/open-first.json")["rows"])
    stats = load(out, "stats.json")
    assert not any("excerpt_en" in r or "codes" in r for r in stats["closing_soon"] + stats["new_tenders"])
    category = load(out, "categories/72.json")
    assert category["open_tenders"] and not any("excerpt_en" in r for r in category["open_tenders"])
    assert es.excerpt("  short   text ", "en") == "short text" and es.excerpt(None, "en") is None


def test_the_open_levels_count_each_family_and_class_once_a_notice_with_the_names_the_notices_give(conn, tmp_path):
    """tenders/open-levels.json: the families (4 digits) and classes (6) under the open notices' codes, for the
    segment pages and the tender list's code filter. A notice counts once in each level its codes fall in; a
    level the notices never named by its own code has no name; a closed notice and a bare segment add none."""
    seed(conn)
    tender(conn, "cb-levels", 0, title="Two codes in one class", codes=("81111501", "81111502"))
    conn.execute("INSERT INTO unspsc_codes (code, level, desc_en, desc_fr) "
                 "VALUES ('8111', 2, 'Computer services', 'Services informatiques')")
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    levels = load(out, "tenders/open-levels.json")["levels"]
    assert [lv["code"] for lv in levels] == sorted(lv["code"] for lv in levels)
    by_code = {lv["code"]: lv for lv in levels}
    # cb-100-1 (81111500 and 8211), cb-300-3 (81111500) and cb-levels; cb-200-2 (72101500); the expired
    # cb-400-4 and the segment-only code 43 add nothing.
    assert {c: lv["n"] for c, lv in by_code.items()} == {"7210": 1, "721015": 1, "8111": 3, "811115": 3, "8211": 1}
    assert (by_code["8111"]["en"], by_code["8111"]["fr"]) == ("Computer services", "Services informatiques")
    assert by_code["811115"]["en"] is None and by_code["811115"]["fr"] is None
    assert es.LEVEL_DIGITS == (4, 6) and len(levels) <= es.LEVELS_MAX


# -- the home page's Canada map -----------------------------------------------------------------

PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]


def test_a_map_layer_counts_a_notice_in_each_province_it_is_placed_in_and_once_when_placed_in_none():
    rows = [
        {"provinces": ["BC"]},
        {"provinces": [], "provinces_derived": ["BC"]},
        {"provinces": ["ON", "QC"]},
        {"provinces": ["ON"], "provinces_derived": ["NS"]},
        {"provinces": []},
        {"provinces": ["XX"]},
    ]
    layer = es.province_counts(rows)
    assert layer["n"] == 6
    # Canada-wide or not stated: the notice with none, and the one whose only code is not a province's.
    assert layer["not_stated"] == 2
    # Every code, zeros kept; the stated and the derived both count, and the two-province notice counts twice.
    assert layer["provinces"] == {**dict.fromkeys(PROVINCES, 0), "BC": 2, "ON": 2, "QC": 1, "NS": 1}
    assert list(layer["provinces"]) == PROVINCES
    assert sum(layer["provinces"].values()) == 6 > layer["n"] - layer["not_stated"]
    assert es.province_counts([]) == {"n": 0, "not_stated": 0, "provinces": dict.fromkeys(PROVINCES, 0)}


def test_stats_map_counts_the_new_open_and_closing_soon_notices_by_province_stated_or_derived(conn, tmp_path):
    """stats.json "map", the home page's Canada map: a layer per list the nightly writes, each notice counted in
    every province it is placed in, by a stated province or a derived one, and the notices placed in none apart.
    The seed's open notices: cb-100-1, cb-300-3 and the colon reference in ON, cb-200-2 in BC (new today and
    closing within the week), the colon reference new today too."""
    seed(conn)
    tender(conn, "cb-map-two", 0, title="Two provinces", published="2026-10-31", closing="2026-11-04T14:00:00",
           provinces=("ON", "QC"))
    tender(conn, "cb-map-derived", 0, title="Placed by a city", closing="2026-11-25T14:00:00", first_seen="2026-10-29",
           provinces=())
    tender(conn, "cb-map-none", 0, title="Canada-wide", published="2026-10-31", closing="2026-11-06T14:00:00", provinces=())
    tender(conn, "cb-map-both", 0, title="Stated and derived", published="2026-10-31", closing="2026-12-01T14:00:00",
           provinces=("ON",))
    conn.execute("UPDATE tenders SET provinces_derived = '[\"NS\"]', provinces_from = 'delivery' "
                 "WHERE reference = 'cb-map-derived'")
    conn.execute("UPDATE tenders SET provinces_derived = '[\"QC\"]', provinces_from = 'delivery' "
                 "WHERE reference = 'cb-map-both'")
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    stats = load(out, "stats.json")
    layers = stats["map"]
    assert set(layers) == {"new_today", "open", "closing_7d"}
    zero = dict.fromkeys(PROVINCES, 0)

    assert layers["open"] == {"n": 8, "not_stated": 1, "provinces": {**zero, "ON": 5, "BC": 1, "QC": 2, "NS": 1}}
    assert layers["new_today"] == {"n": 5, "not_stated": 1, "provinces": {**zero, "BC": 1, "ON": 3, "QC": 2}}
    assert layers["closing_7d"] == {"n": 3, "not_stated": 1, "provinces": {**zero, "BC": 1, "ON": 1, "QC": 1}}
    # Each layer is its list: the open count, the day's file, the closing-soon count.
    assert layers["open"]["n"] == stats["counts"]["tenders_open"] == len(load(out, "tenders/open.json"))
    assert layers["new_today"]["n"] == len(load(out, "tenders/new/2026-10-31.json")) == stats["counts"]["tenders_new_today"]
    assert layers["closing_7d"]["n"] == stats["counts"]["tenders_closing_soon"]
    # The province filter's facet reads the open notices the same way.
    facet = {f["value"]: f["n"] for f in load(out, "tenders/open-first.json")["facets"]["province"]}
    assert facet == {code: n for code, n in layers["open"]["provinces"].items() if n}


def test_an_empty_export_maps_every_province_at_zero(tmp_path):
    conn = connect(memory=True)
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    empty = {"n": 0, "not_stated": 0, "provinces": dict.fromkeys(PROVINCES, 0)}
    assert load(out, "stats.json")["map"] == {"new_today": empty, "open": empty, "closing_7d": empty}


# -- the Public Accounts' payments: their own blocks, and nothing else moves ---------------------------------

PA_HEAD = ("Fscl-yr_Ex-fin,Min-code,Min-portfolio_Portefeuille-min_eng,Min-portfolio_Portefeuille-min_fra,Dept-nbr_No-min,"
           "Dept-name_Nom-min_eng,Dept-name_Nom-min_fra,Rpt-obj_Art-rppt,Rpt-obj_Art-rppt_eng,Rpt-obj_Art-rppt_fra,"
           "Contractor-details_Details-entrepr_eng,Contractor-details_Details-entrepr_fra,Contractor-city_Ville-entrepr_eng,"
           "Contractor-city_Ville-entrepr_fra,Contractor-province_Province-entrepr_eng,Contractor-province_Province-entrepr_fra,"
           "Contractor-country_Pays-entrepr_eng,Contractor-country_Pays-entrepr_fra,Xpnd-current-yr_Dep-ex-courant,"
           "Aggregate-payments_Versements-totalisant")


def _pa_file(path: Path) -> Path:
    """A services file whose payees are the seed's suppliers, paid by the seed's National Defence."""
    import csv
    import io

    dept = ["2025/2026", "11", "National Defence", "Défense nationale", "018", "Department of National Defence",
            "Ministère de la Défense nationale", "47", "Informatics Services", "Services informatiques"]
    place = ["Ottawa", "Ottawa", "Ontario", "Ontario", "", ""]
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(PA_HEAD.split(","))
    writer.writerows([
        [*dept, "", "", "", "", "", "", "", "", 2750000, 0],
        [*dept, ACME, ACME, *place, 0, 2000000],
        [*dept, NORTH, NORTH, *place, 0, 600000],
        [*dept, "Service payments under $100,000 (3)", "Paiements de service inférieurs à 100 000 $ (3)", "", "", "", "", "", "", 0, 150000],
    ])
    path.write_text(out.getvalue(), encoding="utf-8-sig", newline="")
    return path


def test_payments_change_their_own_blocks_and_the_files_read_and_nothing_else(conn, tmp_path):
    """No payment meets a contract value: an export with a Public Accounts file applied is byte for byte the export
    without it (the static tree, the CSV downloads, the organizations' totals and years, the buyers' years), apart
    from the profiles' and the buyer file's public_accounts blocks and stats.json's rows of files read."""
    from awardwatch_pipeline import export, organizations
    from awardwatch_pipeline.sources import contracts, matching
    from awardwatch_pipeline.sources import public_accounts as pa

    ids = seed(conn)
    # The department's title as CKAN gives it, which the resolver matches the file's legal name to.
    conn.execute("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES ('National Defence', 'ckan', 'dnd-mdn')")
    conn.commit()

    def snapshot(name: str):
        out = tmp_path / name
        es.export_static(conn, out / "static", today=TODAY, base_url=BASE)
        export.export_csv(conn, out / "csv", today=TODAY)
        files = {p.relative_to(out).as_posix(): p.read_bytes() for p in out.rglob("*") if p.is_file()}
        tables = {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY 1, 2, 3")]
                  for t in ("organizations", "organization_years", "buyer_years")}
        return files, tables

    before, before_tables = snapshot("without")
    path = _pa_file(tmp_path / "pa.csv")
    parsed = pa.read_file(path, matching.PersonDrops(), withheld=frozenset())
    assert [r.kind for r in parsed.rows] == ["header", "named", "named", "under"]
    pa.apply(conn, parsed, pa.Resource(fy=2025, url="https://example.invalid/idsps-dipss-2026.csv", resource_id="r", ckan_modified=None),
             digest=contracts.sha256(path), etag=None, last_modified=None, stamp="2026-10-31T02:00:00Z")
    assert {r[0] for r in conn.execute("SELECT organization_id FROM pa_payments WHERE kind = 'named'")} == {ids[ACME], ids[NORTH]}
    organizations.recompute(conn, now="2026-10-31T01:00:00Z")
    indicators.compute(conn, now="2026-10-31T01:00:00Z")
    after, after_tables = snapshot("with")
    assert after_tables == before_tables
    assert set(after) == set(before)
    changed = sorted(k for k in after if after[k] != before[k])
    shards = sorted({f"static/profiles/{es.shard_key(ids[ACME])}.json", f"static/profiles/{es.shard_key(ids[NORTH])}.json"})
    assert changed == sorted([*shards, "static/buyers/dnd-mdn.json", "static/stats.json"])

    def without_block(raw: bytes) -> object:
        doc = json.loads(raw)
        for value in (doc.values() if "buyer" not in doc else [doc]):
            if isinstance(value, dict):
                value.pop("public_accounts", None)
        return doc

    for name in [*shards, "static/buyers/dnd-mdn.json"]:
        assert without_block(after[name]) == without_block(before[name]), name
    profile = json.loads(after[shards[0]])[ids[ACME]] if es.shard_key(ids[ACME]) in shards[0] else json.loads(after[shards[1]])[ids[ACME]]
    assert profile["public_accounts"]["services"][0]["rows"][0][:4] == ["dnd-mdn", "47", 2_000_000, ACME]
    # The profile's own totals are the contract figures they were: no payment in them.
    assert profile["organization"] == json.loads(before[f"static/profiles/{es.shard_key(ids[ACME])}.json"])[ids[ACME]]["organization"]
    stats_a, stats_b = json.loads(before["static/stats.json"]), json.loads(after["static/stats.json"])
    for doc in (stats_a, stats_b):
        doc.pop("runs")
    files_b = stats_b.pop("sources")
    files_a = stats_a.pop("sources")
    assert stats_a == stats_b
    assert [r for r in files_b if r["source"] != "pa_services"] == [r for r in files_a if r["source"] != "pa_services"]
    assert [r["file"] for r in files_b if r["source"] == "pa_services"] == ["idsps-dipss-2026.csv"]
    buyer = json.loads(after["static/buyers/dnd-mdn.json"])["public_accounts"]
    assert buyer["classes"] == [{"cls": "47", "en": "Informatics Services", "fr": "Services informatiques", "total": 2_750_000,
                                 "named": [2, 2_600_000], "under": [3, 150_000], "federal": [0, 0], "withheld": 0}]
