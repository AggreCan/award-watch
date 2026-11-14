"""The public_accounts stage (sources/public_accounts.py): the 2026 layout of the professional and special services
file, its row kinds and class blocks, the person rules, federal payees, the place strip, the link (never a new
organization), the nightly relink, the cadence and its holds, the stage's failures as notices, and the blocks
the export writes. The fixture (fixtures/public_accounts_services.csv) is invented and laid out as the 2026
file is: a byte-order mark, both languages, a payee written with its city, the portfolio columns of one
department swapped."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, config, export_static
from awardwatch_pipeline.db import get_meta, set_meta
from awardwatch_pipeline.normalize import norm_name, org_id
from awardwatch_pipeline.sources import buyers, contracts, matching
from awardwatch_pipeline.sources import public_accounts as pa
from conftest import FakeResponse

STAMP = "2026-11-12T03:00:00Z"
URL = "https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/idsps-dipss/idsps-dipss-2026.csv"
CKAN = config.CKAN_PACKAGE_SHOW.format(dataset=config.PA_SERVICES_DATASET)
# The invented names a person rule withholds: none may reach a table, a log row or the review file.
PERSONS = ("Quentaro Z", "Zorblax Quentaro", "Quentaro Z Medicine", "Vexlor QZ")
ORGS = {"Cedarline Analytics Inc": "ON", "Marlowe Hydrographics Ltd": "ON", "Brightwell Consulting Inc": "ON",
        "Lumenvault Inc": "ON", "Halcyon Consulting Services": "ON", "Tidewater Innovate BC": "BC"}


def fixture_text(fixtures: Path) -> str:
    return (fixtures / "public_accounts_services.csv").read_text(encoding="utf-8-sig")


def write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8-sig", newline="")
    return path


def org(conn, name: str, province: str = "ON", country: str = "CA") -> str:
    oid = org_id(norm_name(name))
    conn.execute("INSERT INTO organizations (id, display_name, norm_name, country, province, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                 (oid, name, norm_name(name), country, province or None, STAMP))
    conn.execute("INSERT INTO organization_places (organization_id, country, province, city, postal_code, n) VALUES (?, ?, ?, '', '', 1)",
                 (oid, country, province))
    return oid


@pytest.fixture
def world(conn):
    """Two departments as CKAN lists them, and the organizations some payees name."""
    buyers.upsert_ckan(conn, {"name": "exa-aex", "title_translated": {"en": "Exemplar Affairs Canada", "fr": "Affaires exemplaires Canada"},
                              "shortform": {"en": "EXA", "fr": "AEX"}}, now=STAMP)
    buyers.upsert_ckan(conn, {"name": "sw-te", "title_translated": {"en": "Sample Works Canada", "fr": "Travaux exemplaires Canada"},
                              "shortform": {"en": "SW", "fr": "TE"}}, now=STAMP)
    ids = {name: org(conn, name, prov) for name, prov in ORGS.items()}
    ids["Halden Systems AG"] = org(conn, "Halden Systems AG", "", "DE")
    conn.commit()
    return ids


def load(conn, fixtures, tmp_path, text: str | None = None, drops=None):
    """Read and apply one copy of the file, as the stage does with a download."""
    path = write(tmp_path / "pa.csv", text if text is not None else fixture_text(fixtures))
    parsed = pa.read_file(path, drops or matching.PersonDrops(), withheld=frozenset())
    res = pa.Resource(fy=2025, url=URL, resource_id="res-2026", ckan_modified="2026-11-06T00:00:00")
    linked = pa.apply(conn, parsed, res, digest=contracts.sha256(path), etag='"e1"', last_modified="Fri, 06 Nov 2026 19:31:51 GMT",
                      stamp=STAMP)
    return parsed, linked


def rows(conn, **where) -> list:
    sql = "SELECT * FROM pa_payments" + (" WHERE " + " AND ".join(f"{k} = ?" for k in where) if where else "") + " ORDER BY seq"
    return conn.execute(sql, tuple(where.values())).fetchall()


def payee(conn, name: str):
    return conn.execute("SELECT * FROM pa_payments WHERE payee_raw = ? ORDER BY seq", (name,)).fetchone()


def record(url: str = URL, modified: str = "2026-11-06T00:00:00") -> bytes:
    base = "https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/idsps-dipss/"
    resources = [
        {"id": "res-2025", "url": base + "idsps-dipss-2025.csv", "last_modified": "2026-10-20T00:00:00", "format": "CSV"},
        {"id": "res-2026", "url": url, "last_modified": modified, "format": "CSV"},
        {"id": "res-2021", "url": base + "idsps-dipss-2021-eng.csv", "last_modified": "2026-10-20T00:00:00", "format": "CSV"},
        {"id": "dd", "url": "https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/cp-pa-dd.xml", "last_modified": None, "format": "XML"},
    ]
    return json.dumps({"success": True, "result": {"id": config.PA_SERVICES_DATASET, "resources": resources}}).encode()


def stage(conn, client, tmp_path, now: str = STAMP):
    return pa.run(conn, client, now=now, work_dir=tmp_path / "work", review_dir=tmp_path / "review")


def log_row(conn):
    return conn.execute("SELECT * FROM sources_log WHERE source = 'public_accounts' ORDER BY id DESC").fetchone()


# -- reading the file ------------------------------------------------------------------------------------


def test_the_2026_layout_reads_four_row_kinds_and_every_block_adds_up(fixtures, tmp_path):
    parsed = pa.read_file(write(tmp_path / "pa.csv", fixture_text(fixtures)), matching.PersonDrops(), withheld=frozenset())
    assert (parsed.fy, parsed.layout, parsed.read, parsed.skipped, parsed.extra) == (2025, "split2026", 29, 0, [])
    kinds = [r.kind for r in parsed.rows]
    assert kinds.count("header") == 3 and kinds.count("under") == 4 and kinds.count("withheld") == 5 and kinds.count("named") == 17
    under = [(r.n_payees, r.cents) for r in parsed.rows if r.kind == "under"]
    # "(12)", "(1)" written for one payee, "(5 payees)", and a row that gives no count.
    assert under == [(12, 15_000_000), (1, 900_000), (5, 6_000_000), (None, 2_000_000)]
    assert (parsed.blocks, parsed.blocks_off) == (3, [])
    header = next(r for r in parsed.rows if r.kind == "header")
    assert (header.dept_en, header.cls, header.cls_en, header.cls_fr, header.cents) == (
        "Department of Exemplar Affairs", "47", "Informatics Services", "Services informatiques", 433_000_000)


def test_a_file_written_with_crlf_and_one_with_lf_read_the_same(fixtures, tmp_path):
    text = fixture_text(fixtures)
    a = pa.read_file(write(tmp_path / "lf.csv", text), matching.PersonDrops(), withheld=frozenset())
    b = pa.read_file(write(tmp_path / "crlf.csv", text.replace("\n", "\r\n")), matching.PersonDrops(), withheld=frozenset())
    assert a.rows == b.rows


def test_the_portfolio_columns_are_never_read(fixtures, tmp_path):
    """The works file of 2026 swaps them; whichever way round they stand, the rows are the same."""
    text = fixture_text(fixtures)
    swapped = text.replace(",Travaux exemplaires,Sample Works,", ",Sample Works,Travaux exemplaires,")
    assert swapped != text
    a = pa.read_file(write(tmp_path / "a.csv", text), matching.PersonDrops(), withheld=frozenset())
    b = pa.read_file(write(tmp_path / "b.csv", swapped), matching.PersonDrops(), withheld=frozenset())
    assert a.rows == b.rows


def test_a_missing_column_is_refused_before_a_row_is_written(conn, world, fixtures, tmp_path):
    load(conn, fixtures, tmp_path)
    before = [tuple(r) for r in rows(conn)]
    lines = fixture_text(fixtures).split("\n")
    head = lines[0].split(",")
    cut = "\n".join(",".join(c for i, c in enumerate(line.split(",")) if i != head.index("Aggregate-payments_Versements-totalisant"))
                    for line in lines if line)
    with pytest.raises(contracts.LayoutError, match="lacks Aggregate-payments_Versements-totalisant"):
        pa.read_file(write(tmp_path / "cut.csv", cut), matching.PersonDrops())
    assert [tuple(r) for r in rows(conn)] == before


def test_a_block_that_does_not_add_up_is_listed_and_too_many_hold_the_file(fixtures, tmp_path):
    text = fixture_text(fixtures).replace(",,,,,,,,4330000,0", ",,,,,,,,4330999,0")
    parsed = pa.read_file(write(tmp_path / "off.csv", text), matching.PersonDrops(), withheld=frozenset())
    assert parsed.blocks_off == [("Department of Exemplar Affairs", "47", 433_099_900, 433_000_000)]
    # A dollar a row of rounding is no difference.
    near = fixture_text(fixtures).replace(",,,,,,,,4330000,0", ",,,,,,,,4330005,0")
    assert pa.read_file(write(tmp_path / "near.csv", near), matching.PersonDrops(), withheld=frozenset()).blocks_off == []


def test_amounts_and_years():
    assert pa.cents("13911994") == 1_391_199_400 and pa.cents("-23,595") == -2_359_500 and pa.cents("(100)") == -10_000
    assert pa.cents("") is None and pa.cents("n/a") is None
    assert pa.dollars(1_391_199_400) == 13_911_994 and pa.dollars(150) == 1.5
    assert pa.fiscal_year("2025/2026") == 2025 and pa.fiscal_year("2025-2026") == 2025 and pa.fiscal_year("2025/2026-COMP") == 2025
    assert pa.fiscal_year("2025/2027") is None and pa.fiscal_year("") is None
    assert pa.under_count("Service payments under $100,000 (396)") == (True, 396)
    assert pa.under_count("Service Payments Under $100,000") == (True, None)
    assert pa.under_count("Under Ten Consulting Inc") == (False, None)


# -- persons ---------------------------------------------------------------------------------------------


def test_each_person_rule_withholds_and_a_withheld_row_keeps_no_name_or_place(conn, world, fixtures, tmp_path, out_dir):
    drops = matching.PersonDrops()
    load(conn, fixtures, tmp_path, drops=drops)
    withheld = rows(conn, kind="withheld")
    assert [r["why"] for r in withheld] == ["1", "2", "3", "4", "5"]
    for r in withheld:
        assert all(r[c] is None for c in ("payee_raw", "payee_fr", "payee_norm", "city", "city_fr", "prov", "prov_fr", "country",
                                          "country_fr", "prov_code", "organization_id", "payee_buyer_id")), dict(r)
        # The department, the class and the amount stay: the class totals are as published.
        assert r["dept_en"] == "Department of Exemplar Affairs" and r["cls"] == "45" and r["cents"] > 0
    dump = json.dumps([dict(r) for r in rows(conn)], ensure_ascii=False)
    for name in PERSONS:
        assert name not in dump
    # The review list of names withheld is the operator's, private, and leaves the publisher's own out.
    assert drops.names == ["Quentaro Z", "Zorblax Quentaro (MD)", "Quentaro Z Medicine Professional Corporation", "Vexlor QZ"]


@pytest.mark.parametrize(("name", "rule"), [
    ("Name withheld (1)", "1"),
    ("Quentaro Z", "2"),
    ("Quentaro Z, Toronto, Ontario", "2"),
    ("Zorblax Quentaro (Dr)", "3"),
    ("Dr Zorblax Quentaro Professional Corporation", "3"),
    ("Quentaro Z Dental Corporation", "4"),
    ("Quentaro Z Prof. Corp.", "4"),
    ("Vexlor QZ", "5"),
    ("Vexlor Trand QX", "5"),
])
def test_the_person_rules(name, rule):
    assert pa.person_rule(name, name, pa.Places(), ("Toronto", "", "", "")) == rule


@pytest.mark.parametrize("name", [
    "Nordwave SIA", "Lindqvist Partners BV", "Halden Systems AG", "Nordwave AB", "Brightwell Consulting Inc",
    "Tidewater Innovate BC", "Cedarline Analytics Inc", "Marlowe Hydrographics Ltd, Ottawa, Ontario",
    "Gowland WLX",  # three capitals: firms' acronyms on the 2026 file, never withheld by the last rule
    "Halcyon Law Professional Corporation",  # a firm's words before the form
])
def test_firms_stay_named(name):
    assert pa.person_rule(name, name, pa.Places(), ("Ottawa", "", "", "")) is None


def test_a_french_spelling_that_reads_as_a_person_withholds_the_row():
    assert pa.person_rule("Lindqvist Partners BV", "Quentaro Z", pa.Places(), ()) == "2"
    # The last rule reads the English name only: a French spelling translates the words before the capitals.
    assert pa.person_rule("Tidewater Safety", "Sécurité Tidewater NE", pa.Places(), ()) is None


def test_a_hash_listed_by_hand_withholds_a_name_the_rules_keep(conn, world, fixtures, tmp_path, monkeypatch):
    seed = tmp_path / "withhold.txt"
    seed.write_text(f"# by hand\n{pa.withhold_key(norm_name('Saltmarsh Ferryman'))}\n", encoding="utf-8")
    monkeypatch.setattr(config, "PA_WITHHOLD", seed)
    assert pa.read_withheld() == frozenset({pa.withhold_key("saltmarsh ferryman")})
    path = write(tmp_path / "pa.csv", fixture_text(fixtures))
    parsed = pa.read_file(path, matching.PersonDrops())
    kept = [r for r in parsed.rows if r.why == "seed"]
    assert len(kept) == 1 and kept[0].payee_en is None and kept[0].cents == 10_200_000
    # The hashes are part of the rules a file was read under: a line added reads the files again.
    before = pa.rules()
    seed.write_text("", encoding="utf-8")
    assert pa.rules() != before


# -- federal payees, the strip, the link -------------------------------------------------------------------


def test_federal_payees_by_the_strict_test_and_the_general_resolvers_readings_kept_as_organizations(conn, world, fixtures, tmp_path):
    _, linked = load(conn, fixtures, tmp_path)
    federal = {r["payee_raw"]: r["payee_buyer_id"] for r in rows(conn, kind="federal")}
    # A department's name as the file writes it, and the same name inverted with its acronym.
    assert federal == {"Department of Sample Works": "sw-te", "Sample Works (Department of) (SW)": "sw-te"}
    for r in rows(conn, kind="federal"):
        assert r["organization_id"] is None
    # A misspelling and a firm whose acronym is a department's stay organizations, unlinked, and are listed.
    for name in ("Department of Exemplar Affairs Canda", "SW Inc"):
        r = payee(conn, name)
        assert (r["kind"], r["organization_id"]) == ("named", None), name
    assert sorted(linked.loose) == [("Department of Exemplar Affairs Canda", "exa-aex"), ("SW Inc", "sw-te")]


def test_the_place_written_after_a_name_is_cut_and_a_name_without_a_comma_is_not():
    places = pa.Places()
    places.add("Ottawa", "Ottawa", "Ontario", "Ontario")
    assert pa.strip_place("Marlowe Hydrographics Ltd, Ottawa, Ontario", places) == "Marlowe Hydrographics Ltd"
    assert pa.strip_place("Marlowe Hydrographics Ltd, Kanata, ON", places, "Kanata") == "Marlowe Hydrographics Ltd"
    assert pa.strip_place("Innovate BC", places) == "Innovate BC"
    assert pa.strip_place("Halcyon, Brightwell and Partners", places) == "Halcyon, Brightwell and Partners"
    assert pa.strip_place("Ottawa, Ontario", places) == "Ottawa"


def test_the_link_by_exact_name_through_an_alias_the_common_name_rule_and_the_place_flag(conn, world, fixtures, tmp_path):
    before = conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0]
    _, linked = load(conn, fixtures, tmp_path)
    cedarline = [r for r in rows(conn) if r["payee_raw"] == "Cedarline Analytics Inc"]
    assert [(r["organization_id"], r["pf"], r["cents"]) for r in cedarline] == [
        (world["Cedarline Analytics Inc"], 0, 120_000_000), (world["Cedarline Analytics Inc"], 0, -500_000),
        (world["Cedarline Analytics Inc"], 0, 200_000_000)]
    # The city in the name is cut before the name is normalized.
    marlowe = payee(conn, "Marlowe Hydrographics Ltd, Ottawa, Ontario")
    assert (marlowe["organization_id"], marlowe["payee_norm"]) == (world["Marlowe Hydrographics Ltd"], "marlowe hydrographics")
    assert payee(conn, "Tidewater Innovate BC")["organization_id"] == world["Tidewater Innovate BC"]
    # A firm paid in Quebec whose profile has addresses in Ontario only: linked, flagged.
    brightwell = payee(conn, "Brightwell Consulting Inc")
    assert (brightwell["organization_id"], brightwell["pf"], brightwell["prov_code"]) == (world["Brightwell Consulting Inc"], 1, "QC")
    # One word: linked only in the organization's own province.
    lumen = payee(conn, "Lumenvault")
    assert (lumen["organization_id"], lumen["why"]) == (None, "common")
    # A match key naming an organization is a candidate for review, never a link.
    halcyon = payee(conn, "Halcyon Cnslt Services Inc")
    assert (halcyon["organization_id"], halcyon["why"]) == (None, "key")
    assert linked.keys == [("Halcyon Cnslt Services Inc", 1, [world["Halcyon Consulting Services"]])]
    # A payee abroad, and one with no place, link like any other; nothing names a new organization.
    assert payee(conn, "Halden Systems AG")["organization_id"] == world["Halden Systems AG"]
    assert payee(conn, "Halden Systems AG")["prov_code"] == "XX" and payee(conn, "Ferncastle Holdings Ltd")["prov_code"] is None
    assert payee(conn, "Nordwave SIA")["why"] == "none"
    assert conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0] == before
    # Every department resolved to its buyer through the resolver's own rules.
    assert {r["buyer_id"] for r in rows(conn)} == {"exa-aex", "sw-te"}


def test_the_nightly_relink_follows_a_merge_and_a_removal(conn, world, fixtures, tmp_path):
    load(conn, fixtures, tmp_path)
    old = world["Cedarline Analytics Inc"]
    new = org(conn, "Cedarline Analytics Group", "ON")
    conn.execute("INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at, reason) VALUES (?, ?, 3, ?, 'spelling')",
                 (old, new, STAMP))
    conn.execute("DELETE FROM organization_places WHERE organization_id = ?", (old,))
    conn.execute("DELETE FROM organizations WHERE id = ?", (old,))
    conn.commit()
    # The foreign key clears the link at once; the relink sends the payments to the organization that took the records.
    assert {r["organization_id"] for r in rows(conn) if r["payee_raw"] == "Cedarline Analytics Inc"} == {None}
    linked = pa.relink(conn, stamp=STAMP)
    assert {r["organization_id"] for r in rows(conn) if r["payee_raw"] == "Cedarline Analytics Inc"} == {new}
    assert linked.changed == 3
    assert pa.relink(conn, stamp=STAMP).changed == 0


def test_the_department_seed_rows_resolve():
    from awardwatch_pipeline.db import connect
    conn = connect(memory=True)
    buyers.load_seed(conn, buyers.read_seed(), now=STAMP)
    expected = {
        "Canada Foundation for Innovation": "innovation", "Canadian Broadcasting Corporation": "cbc-radio-canada",
        "Canadian Transportation Accident Investigation and Safety Board": "tsb-bst", "Northern Pipeline Agency": "npa-apn",
        "Office of the Director of Public Prosecutions": "ppsc-sppc", "Registrar of the Supreme Court of Canada": "scc-csc",
        "Windsor-Detroit Bridge Authority": "wdba-apwd", "Royal Canadian Mounted Police External Review Committee": "erc-cee",
    }
    for name, bid in expected.items():
        assert buyers.resolve(conn, name, source=pa.SOURCE, now=STAMP) == bid, name
    assert buyers.take_notices(conn) == []


# -- applying a file ---------------------------------------------------------------------------------------


def test_a_file_applied_again_changes_nothing_and_a_new_copy_replaces_the_year_in_one_transaction(conn, world, fixtures, tmp_path, monkeypatch):
    load(conn, fixtures, tmp_path)
    first = [tuple(r) for r in rows(conn)]
    load(conn, fixtures, tmp_path)
    assert [tuple(r) for r in rows(conn)] == first
    # A new copy of the year with a row fewer: the year's rows are the new copy's, whole.
    text = "\n".join(line for line in fixture_text(fixtures).split("\n") if "Ferncastle" not in line)
    text = text.replace(",,,,,,,,3680000,0", ",,,,,,,,3530000,0")
    load(conn, fixtures, tmp_path, text)
    assert payee(conn, "Ferncastle Holdings Ltd") is None and len(rows(conn)) == len(first) - 1
    # A fault part way through leaves the rows of the copy before.
    before = [tuple(r) for r in rows(conn)]

    def broken(*args, **kwargs):
        raise RuntimeError("relink broke")

    monkeypatch.setattr(pa, "relink", broken)
    with pytest.raises(RuntimeError):
        load(conn, fixtures, tmp_path)
    assert [tuple(r) for r in rows(conn)] == before


# -- the stage: cadence, holds, failures -----------------------------------------------------------------


def test_the_stage_reads_the_file_once_and_then_asks_only_for_the_record_when_due(conn, world, fixtures, fake_client, tmp_path):
    body = (fixtures / "public_accounts_services.csv").read_bytes()
    client = fake_client({CKAN: record(), URL: FakeResponse(200, body, {"ETag": '"e1"', "Last-Modified": "Fri, 06 Nov 2026 19:31:51 GMT"})})
    calls = client.fake_session.calls
    result = stage(conn, client, tmp_path)
    assert result.state == "read" and [c[0] for c in calls] == [CKAN, URL]
    row = log_row(conn)
    assert row["ok"] == 1 and row["detail"] == (
        "read fy=2025-26 files=1 rows=29 named=15 linked=7 unlinked=8 withheld=5 federal=2 flagged=1 held=none")
    assert row["rows_in"] == 29 and row["excluded"] == 5
    applied = conn.execute("SELECT * FROM pa_files").fetchone()
    assert (applied["fy"], applied["url"], applied["etag"], applied["ckan_modified"], applied["rules"], applied["rows"]) == (
        2025, URL, '"e1"', "2026-11-06T00:00:00", pa.rules(), 29)
    # An hour later: not due, no request at all.
    calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-12T04:00:00Z").state == "not due" and calls == []
    # The next night, in the release season: the record is read, it lists the same file, nothing is downloaded.
    assert stage(conn, client, tmp_path, now="2026-11-13T03:00:00Z").state == "unchanged" and [c[0] for c in calls] == [CKAN]
    # Out of the season the record is read weekly.
    calls.clear()
    set_meta(conn, pa.META_CHECKED, "2027-03-01T03:00:00Z")
    conn.commit()
    assert stage(conn, client, tmp_path, now="2027-03-05T03:00:00Z").state == "not due" and calls == []
    assert stage(conn, client, tmp_path, now="2027-03-08T03:00:00Z").state == "unchanged" and [c[0] for c in calls] == [CKAN]
    # Every night, whatever the record said, the links are computed again (one log row a night).
    assert conn.execute("SELECT COUNT(*) FROM sources_log WHERE source = 'public_accounts'").fetchone()[0] == 5


def test_a_changed_record_sends_a_conditional_request_and_the_same_bytes_are_not_read_again(conn, world, fixtures, fake_client, tmp_path):
    body = (fixtures / "public_accounts_services.csv").read_bytes()
    client = fake_client({CKAN: record(), URL: FakeResponse(200, body, {"ETag": '"e1"'})})
    stage(conn, client, tmp_path)
    applied_at = conn.execute("SELECT applied_at FROM pa_files").fetchone()[0]
    client.fake_session.mapping[CKAN] = record(modified="2026-11-07T00:00:00")
    client.fake_session.mapping[URL] = FakeResponse(304)
    client.fake_session.calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-13T03:00:00Z").state == "unchanged"
    assert client.fake_session.calls[1][1].get("If-None-Match") == '"e1"'
    assert conn.execute("SELECT ckan_modified FROM pa_files").fetchone()[0] == "2026-11-07T00:00:00"
    # The record moves again and the host sends the same bytes: nothing is read or rebuilt.
    client.fake_session.mapping[CKAN] = record(modified="2026-11-08T00:00:00")
    client.fake_session.mapping[URL] = FakeResponse(200, body, {"ETag": '"e2"'})
    assert stage(conn, client, tmp_path, now="2026-11-14T03:00:00Z").state == "unchanged"
    row = conn.execute("SELECT applied_at, etag FROM pa_files").fetchone()
    assert tuple(row) == (applied_at, '"e2"')


def test_a_refused_download_or_record_and_an_unknown_layout_end_ok_with_a_notice(conn, world, fixtures, fake_client, tmp_path):
    body = (fixtures / "public_accounts_services.csv").read_bytes()
    client = fake_client({CKAN: record(), URL: FakeResponse(200, body)})
    stage(conn, client, tmp_path)
    before = [tuple(r) for r in rows(conn)]
    # The record does not answer.
    client.fake_session.mapping[CKAN] = FakeResponse(404)
    result = stage(conn, client, tmp_path, now="2026-11-13T03:00:00Z")
    row = log_row(conn)
    assert (result.state, row["ok"]) == ("not read", 1) and "the dataset record could not be read" in row["notice"]
    # A new copy the host refuses.
    client.fake_session.mapping[CKAN] = record(modified="2026-11-09T00:00:00")
    client.fake_session.mapping[URL] = FakeResponse(403)
    result = stage(conn, client, tmp_path, now="2026-11-14T03:00:00Z")
    row = log_row(conn)
    assert (result.state, row["ok"]) == ("not read", 1) and "could not be downloaded" in row["notice"]
    # A new copy whose layout is not known: refused, and not downloaded again while the record lists the same copy.
    lines = body.decode("utf-8-sig").replace("Contractor-city_Ville-entrepr_eng", "Contractor-town_Ville-entrepr_eng")
    client.fake_session.mapping[URL] = FakeResponse(200, lines.encode("utf-8"))
    result = stage(conn, client, tmp_path, now="2026-11-15T03:00:00Z")
    row = log_row(conn)
    assert (result.state, row["ok"]) == ("refused", 1) and "lacks Contractor-city_Ville-entrepr_eng" in row["notice"]
    client.fake_session.calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-16T03:00:00Z").state == "refused"
    assert [c[0] for c in client.fake_session.calls] == [CKAN] and "held=layout" in log_row(conn)["detail"]
    assert [tuple(r) for r in rows(conn)] == before
    assert all(r["ok"] == 1 for r in conn.execute("SELECT ok FROM sources_log WHERE source = 'public_accounts'"))


def test_a_copy_with_far_fewer_rows_is_held_until_released(conn, world, fixtures, fake_client, tmp_path, monkeypatch):
    body = (fixtures / "public_accounts_services.csv").read_bytes()
    client = fake_client({CKAN: record(), URL: FakeResponse(200, body)})
    stage(conn, client, tmp_path)
    before = [tuple(r) for r in rows(conn)]
    text = body.decode("utf-8-sig")
    lines = text.split("\n")
    # The second department's block alone: 6 named rows left of 22 named, federal or withheld.
    short = "\n".join([lines[0], *[line for line in lines[1:] if ",902," in line]]) + "\n"
    client.fake_session.mapping[CKAN] = record(modified="2026-11-09T00:00:00")
    client.fake_session.mapping[URL] = FakeResponse(200, short.encode("utf-8"))
    monkeypatch.setattr(config, "PA_RELEASE", tmp_path / "release.txt")
    result = stage(conn, client, tmp_path, now="2026-11-13T03:00:00Z")
    row = log_row(conn)
    assert (result.state, row["ok"]) == ("held", 1) and "more than 30 percent fewer" in row["notice"]
    assert [tuple(r) for r in rows(conn)] == before and "held=2025" in row["detail"]
    client.fake_session.calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-14T03:00:00Z").state == "held"
    assert [c[0] for c in client.fake_session.calls] == [CKAN]
    held = pa.held_copy(conn)
    (tmp_path / "release.txt").write_text(held["sha256"][:12] + "\n", encoding="utf-8")
    assert stage(conn, client, tmp_path, now="2026-11-15T03:00:00Z").state == "read"
    assert len(rows(conn)) == len(short.strip().split("\n")) - 1 and pa.held_copy(conn) is None


def test_a_change_of_rules_reads_the_file_again_from_its_address(conn, world, fixtures, fake_client, tmp_path, monkeypatch):
    body = (fixtures / "public_accounts_services.csv").read_bytes()
    client = fake_client({CKAN: record(), URL: FakeResponse(200, body, {"ETag": '"e1"'})})
    stage(conn, client, tmp_path)
    monkeypatch.setattr(pa, "RULES_VERSION", pa.RULES_VERSION + 1)
    client.fake_session.calls.clear()
    # Not due for the record, but the file is read again, without its validators.
    result = stage(conn, client, tmp_path, now="2026-11-12T04:00:00Z")
    assert result.state == "read" and [c[0] for c in client.fake_session.calls] == [URL]
    assert "If-None-Match" not in client.fake_session.calls[0][1]
    assert conn.execute("SELECT rules FROM pa_files").fetchone()[0] == pa.rules()


def test_names_never_reach_the_log_and_the_review_file_names_no_person(conn, world, fixtures, fake_client, tmp_path):
    body = (fixtures / "public_accounts_services.csv").read_bytes()
    client = fake_client({CKAN: record(), URL: FakeResponse(200, body)})
    stage(conn, client, tmp_path)
    for row in conn.execute("SELECT detail, notice FROM sources_log"):
        text = (row["detail"] or "") + (row["notice"] or "")
        for name in PERSONS:
            assert name not in text
    review = (tmp_path / "review" / pa.REVIEW_FILE).read_text(encoding="utf-8")
    for name in PERSONS:
        assert name not in review
    assert "Halcyon Cnslt Services Inc\t1\t" in review and "Brightwell Consulting Inc" in review
    assert "## Federal payees by the strict test: 2" in review and "SW Inc\tsw-te" in review
    persons = (tmp_path / "review" / pa.PERSONS_FILE).read_text(encoding="utf-8")
    assert "Quentaro Z" in persons and "no step exports, logs or uploads it" in persons
    assert b"\r" not in (tmp_path / "review" / pa.REVIEW_FILE).read_bytes()


def test_a_samples_run_reads_the_sample_and_makes_no_request(conn, world, fixtures, tmp_path, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("a samples run made a request")

    monkeypatch.setattr(cli, "PoliteClient", no_network)
    assert cli.run(conn, ["public_accounts"], samples=tmp_path) == 0
    assert "no pa-services.csv in the samples folder" in log_row(conn)["notice"]
    shutil.copy(fixtures / "public_accounts_services.csv", tmp_path / pa.SAMPLE_NAME)
    assert cli.run(conn, ["public_accounts"], samples=tmp_path) == 0
    assert log_row(conn)["detail"].startswith("read fy=2025-26")


def test_a_fault_in_the_stage_fails_it_and_the_stages_after_it_run(conn, world, fixtures, tmp_path, monkeypatch):
    shutil.copy(fixtures / "public_accounts_services.csv", tmp_path / pa.SAMPLE_NAME)

    def broken(*args, **kwargs):
        raise KeyError("a bug")

    monkeypatch.setattr(pa, "read_file", broken)
    assert cli.run(conn, ["public_accounts", "families"], samples=tmp_path) == 1
    rows_ = {r["source"]: r for r in conn.execute("SELECT source, ok, detail FROM sources_log")}
    assert rows_["public_accounts"]["ok"] == 0 and "KeyError" in rows_["public_accounts"]["detail"]
    assert rows_["families"]["ok"] == 1


def test_the_stage_runs_after_sosa_and_before_the_stages_that_read_the_links():
    assert cli.STAGES.index("public_accounts") == cli.STAGES.index("sosa") + 1
    assert cli.STAGES.index("public_accounts") < cli.STAGES.index("families") < cli.STAGES.index("export")


def test_the_newest_years_bilingual_file_is_the_one_read():
    res = pa.newest_resource(json.loads(record()))
    assert (res.fy, res.url, res.resource_id, res.ckan_modified, res.lang, res.file) == (
        2025, URL, "res-2026", "2026-11-06T00:00:00", "", "idsps-dipss-2026.csv")
    with pytest.raises(ValueError):
        pa.newest_resource({"success": False})
    assert pa.newest_resource({"success": True, "result": {"resources": []}}) is None


def test_the_record_is_due_nightly_in_the_release_season_and_weekly_otherwise(conn):
    assert pa.ckan_due(conn, STAMP)
    set_meta(conn, pa.META_CHECKED, "2026-11-11T03:00:00Z")
    assert not pa.ckan_due(conn, "2026-11-11T20:00:00Z") and pa.ckan_due(conn, "2026-11-12T00:00:00Z")
    set_meta(conn, pa.META_CHECKED, "2026-04-01T03:00:00Z")
    assert not pa.ckan_due(conn, "2026-04-05T03:00:00Z") and pa.ckan_due(conn, "2026-04-08T03:00:00Z")
    set_meta(conn, pa.META_CHECKED, "2027-01-30T03:00:00Z")
    assert pa.ckan_due(conn, "2027-01-31T03:00:00Z")


# -- what the export writes -------------------------------------------------------------------------------


def test_the_profile_block_its_shape_caps_and_order(conn, world, fixtures, tmp_path, monkeypatch):
    load(conn, fixtures, tmp_path)
    listed = {"exa-aex", "sw-te"}
    names = {"exa-aex": ("Exemplar Affairs Canada", "Affaires exemplaires Canada"), "sw-te": ("Sample Works Canada", "Travaux exemplaires Canada")}
    orgs = set(world.values())
    blocks = pa.profile_blocks(conn, orgs=orgs, listed=listed, buyer_names=names)
    assert set(blocks) == {world[n] for n in ("Cedarline Analytics Inc", "Marlowe Hydrographics Ltd", "Brightwell Consulting Inc",
                                                "Tidewater Innovate BC", "Halden Systems AG")}
    cedarline = blocks[world["Cedarline Analytics Inc"]]
    assert cedarline == {
        "v": 1,
        "services": [{"fy": 2025, "n": 3, "total": 3_195_000, "d": 2, "rows": [
            ["sw-te", "89", 2_000_000, "Cedarline Analytics Inc", None, "Ottawa", None, "ON", 0],
            ["exa-aex", "47", 1_200_000, "Cedarline Analytics Inc", None, "Ottawa", None, "ON", 0],
            ["exa-aex", "45", -5_000, "Cedarline Analytics Inc", None, "Ottawa", None, "ON", 0],
        ]}],
        "buyers": {"exa-aex": ["Exemplar Affairs Canada", "Affaires exemplaires Canada"], "sw-te": ["Sample Works Canada", "Travaux exemplaires Canada"]},
        "classes": {"45": ["Health and Welfare Services", "Services de santé et de bien-être"], "47": ["Informatics Services", "Services informatiques"],
                    "89": ["Other Services", "Autres services"]},
        "loaded": [2025, 2025],
    }
    assert blocks[world["Brightwell Consulting Inc"]]["services"][0]["rows"][0][5:] == ["Montréal", None, "QC", 1]
    assert blocks[world["Halden Systems AG"]]["services"][0]["rows"][0][7] == ["Germany", "Allemagne"]
    # A department whose buyer has no page shows under the file's own name, unlinked.
    unlisted = pa.profile_blocks(conn, orgs=orgs, listed={"exa-aex"}, buyer_names=names)[world["Cedarline Analytics Inc"]]
    assert unlisted["buyers"]["pa:902"] == ["Department of Sample Works", "Ministère des Travaux exemplaires"]
    monkeypatch.setattr(pa, "PA_PROFILE_ROWS", 2)
    capped = pa.profile_blocks(conn, orgs=orgs, listed=listed, buyer_names=names)[world["Cedarline Analytics Inc"]]["services"][0]
    assert (capped["n"], len(capped["rows"]), capped["total"]) == (3, 2, 3_195_000)
    assert pa.profile_blocks(conn, orgs=orgs, listed=listed, buyer_names=names) == pa.profile_blocks(
        conn, orgs=orgs, listed=listed, buyer_names=names)


def test_the_buyer_block_splits_each_class_total_as_published(conn, world, fixtures, tmp_path, monkeypatch):
    load(conn, fixtures, tmp_path)
    blocks = pa.buyer_blocks(conn, orgs=set(world.values()), listed={"exa-aex", "sw-te"})
    exa = blocks["exa-aex"]
    assert (exa["v"], exa["fy"], exa["named_rows"], exa["years"]) == (1, 2025, 9, [[2025, 4_330_000 + 648_000]])
    by_cls = {c["cls"]: c for c in exa["classes"]}
    assert by_cls["47"] == {"cls": "47", "en": "Informatics Services", "fr": "Services informatiques", "total": 4_330_000,
                            "named": [7, 3_630_000], "under": [12, 150_000], "federal": [2, 550_000], "withheld": 0}
    # The persons are a count; their amount is only inside the total as published.
    assert by_cls["45"] == {"cls": "45", "en": "Health and Welfare Services", "fr": "Services de santé et de bien-être", "total": 648_000,
                            "named": [2, 97_000], "under": [1, 9_000], "federal": [0, 0], "withheld": 5}
    assert [c["cls"] for c in exa["classes"]] == ["47", "45"]
    first = exa["payees"][0]
    assert first == ["Cedarline Analytics Inc", None, world["Cedarline Analytics Inc"], "47", 1_200_000, "Ottawa", None, "ON"]
    assert ["Lumenvault", None, None, "47", 400_000, "Calgary", None, "AB"] in exa["payees"]
    sw = blocks["sw-te"]
    assert sw["classes"][0]["under"] == [None, 80_000]
    for name in PERSONS:
        assert name not in json.dumps(blocks, ensure_ascii=False)
    monkeypatch.setattr(pa, "PA_BUYER_PAYEES", 2)
    assert len(pa.buyer_blocks(conn, orgs=set(world.values()), listed={"exa-aex"})["exa-aex"]["payees"]) == 2
    assert pa.buyer_blocks(conn, orgs=set(), listed=set()) == {}


def test_no_other_module_reads_the_payments():
    """Payments meet no contract value: only this stage and the export's two guarded blocks read pa_payments."""
    package = Path(pa.__file__).resolve().parents[1]
    readers = sorted(p.relative_to(package).as_posix() for p in package.rglob("*.py") if "pa_payments" in p.read_text(encoding="utf-8"))
    assert readers == ["sources/public_accounts.py"]
    text = (package / "export_static.py").read_text(encoding="utf-8")
    assert text.count("public_accounts.profile_blocks(") == 1 and text.count("public_accounts.buyer_blocks(") == 1
    for schema in ("records_schema.sql", "search_schema.sql", "intraday_schema.sql"):
        assert "pa_payments" not in (package.parent / schema).read_text(encoding="utf-8"), schema


def test_a_fault_in_a_block_builder_leaves_the_block_out_with_a_notice(conn, world, fixtures, tmp_path, monkeypatch):
    load(conn, fixtures, tmp_path)

    def broken(*args, **kwargs):
        raise ValueError("bad block")

    monkeypatch.setattr(pa, "profile_blocks", broken)
    assert export_static.public_accounts_blocks(conn, "profiles", lambda: pa.profile_blocks(conn)) == {}
    row = conn.execute("SELECT ok, notice FROM sources_log WHERE source = 'export_public_accounts'").fetchone()
    assert row["ok"] == 1 and "left out of the profiles tonight (ValueError: bad block)" in row["notice"]


def test_the_data_page_lists_each_file_applied(conn, world, fixtures, tmp_path):
    rows_ = [r for r in export_static.source_files(conn) if r["source"] == "pa_services"]
    assert rows_ == [{"source": "pa_services", "file": "idsps-dipss", "last_read": None, "last_modified": None,
                      "last_modified_http": None, "loaded": False}]
    load(conn, fixtures, tmp_path)
    rows_ = [r for r in export_static.source_files(conn) if r["source"] == "pa_services"]
    assert rows_ == [{"source": "pa_services", "file": "idsps-dipss-2026.csv", "last_read": STAMP, "last_modified": "2026-11-06T19:31:51Z",
                      "last_modified_http": "Fri, 06 Nov 2026 19:31:51 GMT", "loaded": True}]


def test_the_site_holds_the_same_figures():
    """site/src/public_accounts.tsx reads the blocks with the same caps, and its free window is the analytics' own."""
    site = Path(pa.__file__).resolve().parents[3] / "site" / "src"
    text = (site / "public_accounts.tsx").read_text(encoding="utf-8")
    assert f"export const PA_PROFILE_ROWS = {pa.PA_PROFILE_ROWS};" in text
    assert f"export const PA_BUYER_PAYEES = {pa.PA_BUYER_PAYEES};" in text
    assert "export const PA_FREE_YEARS = FREE_YEARS;" in text
    assert f"export const FREE_YEARS = {pa.PA_FREE_YEARS};" in (site / "records_db.ts").read_text(encoding="utf-8")
    assert f'export const PA_DATASET = "{config.PA_SERVICES_DATASET}";' in text


def test_a_block_that_does_not_add_up_is_a_notice_and_too_many_hold_the_copy(conn, world, fixtures, fake_client, tmp_path, monkeypatch):
    body = fixture_text(fixtures).replace(",,,,,,,,4330000,0", ",,,,,,,,4330999,0").encode("utf-8")
    client = fake_client({CKAN: record(), URL: FakeResponse(200, body)})
    # One block of three off: a notice, and the copy is applied (the review file lists the block).
    monkeypatch.setattr(pa, "BLOCKS_OFF_SHARE", 0.5)
    assert stage(conn, client, tmp_path).state == "read"
    assert "1 of 3 class blocks of idsps-dipss-2026.csv do not add up to their total" in log_row(conn)["notice"]
    review = (tmp_path / "review" / pa.REVIEW_FILE).read_text(encoding="utf-8")
    assert "2025\tDepartment of Exemplar Affairs\t47\t433099900\t433000000" in review
    # Past the share, the copy is held and the rows applied before stand.
    monkeypatch.setattr(pa, "BLOCKS_OFF_SHARE", 0.02)
    client.fake_session.mapping[CKAN] = record(modified="2026-11-09T00:00:00")
    client.fake_session.mapping[URL] = FakeResponse(200, body.replace(b",,,,,,,,3680000,0", b",,,,,,,,3680999,0"))
    assert stage(conn, client, tmp_path, now="2026-11-13T03:00:00Z").state == "held"
    assert "2 of 3 class blocks do not add up to their total" in log_row(conn)["notice"]
