"""The works file of the public_accounts stage (sources/public_accounts.py, slice 2): acquisition of land, buildings and
works, fiscal 2025-26. The 2026 layout and its guard, the "Total" rows as each department's line under the threshold,
the rows with no key kept apart by their order in the file, the swapped portfolio columns never read, the project's
province, the person rules on a contractor (persons' names held in trust among them), the "**" marker, the link and
the relink, the stage beside the services file (its own record, cadence, holds and notices), the blocks the export
writes, never summed with the payments for services, and the export's guard that keeps the payments when the works
part faults. The fixture (fixtures/public_accounts_works.csv) is invented and laid out as the 2026 file is: a
byte-order mark, both languages, the portfolio names in the wrong languages on every row."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, config, export_static
from awardwatch_pipeline.db import set_meta
from awardwatch_pipeline.normalize import norm_name, org_id
from awardwatch_pipeline.sources import buyers, contracts, matching
from awardwatch_pipeline.sources import public_accounts as pa
from conftest import FakeResponse

STAMP = "2026-11-16T13:00:00Z"
WORKS_URL = "https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/atbt-albw/atbt-albw-2026.csv"
SERVICES_URL = "https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/idsps-dipss/idsps-dipss-2026.csv"
WORKS_CKAN = config.CKAN_PACKAGE_SHOW.format(dataset=config.PA_WORKS_DATASET)
SERVICES_CKAN = config.CKAN_PACKAGE_SHOW.format(dataset=config.PA_SERVICES_DATASET)
# The invented names the notary rule withholds and rule 6 withholds (two persons held in trust, then three): none
# may reach a table, a log row, a review file or a block.
PERSONS = ("Quentaro Z", "Orrin Vexlor", "Mirelle Tansby", "Dace Holmwick")
# What the withheld rows' projects and places say, which goes with their names.
PROJECTS = ("employee house", "lakeside", "riverain", "farmland", "agricole", "Thunder Bay", "Nipigon", "Kenora", "Dryden")
ORGS = {"Cedarline Analytics Inc": "ON", "Marlowe Hydrographics Ltd": "ON", "Brightwell Consulting Inc": "ON",
        "Lumenvault Inc": "ON", "Tidewater Innovate BC": "BC"}
NAME_COLS = ("payee_raw", "payee_fr", "payee_norm", "city", "city_fr", "prov", "prov_fr", "country", "country_fr", "prov_code",
             "desc_en", "desc_fr", "proj_city", "proj_city_fr", "proj_prov", "proj_prov_fr", "proj_country", "proj_country_fr",
             "proj_prov_code", "organization_id", "payee_buyer_id")


def works_text(fixtures: Path) -> str:
    return (fixtures / "public_accounts_works.csv").read_text(encoding="utf-8-sig")


def services_text(fixtures: Path) -> str:
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
    """Three departments as CKAN lists them, and the organizations some contractors name."""
    for bid, en, fr, short in (("exa-aex", "Exemplar Affairs Canada", "Affaires exemplaires Canada", ("EXA", "AEX")),
                               ("sw-te", "Sample Works Canada", "Travaux exemplaires Canada", ("SW", "TE")),
                               ("qh-pt", "Quiet Harbours Canada", "Ports tranquilles Canada", ("QH", "PT"))):
        buyers.upsert_ckan(conn, {"name": bid, "title_translated": {"en": en, "fr": fr}, "shortform": {"en": short[0], "fr": short[1]}},
                           now=STAMP)
    ids = {name: org(conn, name, prov) for name, prov in ORGS.items()}
    ids["Halden Systems AG"] = org(conn, "Halden Systems AG", "", "DE")
    conn.commit()
    return ids


def resource(url: str = WORKS_URL) -> pa.Resource:
    return pa.Resource(fy=2025, url=url, resource_id="res-w-2026", ckan_modified="2026-11-06T00:00:00")


def load_works(conn, fixtures, tmp_path, text: str | None = None, drops=None, withheld=frozenset()):
    """Read and apply one copy of the works file, as the stage does with a download."""
    path = write(tmp_path / "works.csv", text if text is not None else works_text(fixtures))
    parsed = pa.read_works_file(path, drops or matching.PersonDrops(), withheld=withheld)
    linked = pa.apply(conn, parsed, resource(), digest=contracts.sha256(path), etag='"w1"',
                      last_modified="Fri, 06 Nov 2026 19:31:36 GMT", stamp=STAMP, fam=pa.WORKS)
    return parsed, linked


def load_services(conn, fixtures, tmp_path):
    path = write(tmp_path / "services.csv", services_text(fixtures))
    parsed = pa.read_file(path, matching.PersonDrops(), withheld=frozenset())
    pa.apply(conn, parsed, pa.Resource(fy=2025, url=SERVICES_URL, resource_id="res-2026", ckan_modified="2026-11-06T00:00:00"),
             digest=contracts.sha256(path), etag='"e1"', last_modified="Fri, 06 Nov 2026 19:31:51 GMT", stamp=STAMP)


def works(conn, **where) -> list:
    sql = "SELECT * FROM pa_works" + (" WHERE " + " AND ".join(f"{k} = ?" for k in where) if where else "") + " ORDER BY seq"
    return conn.execute(sql, tuple(where.values())).fetchall()


def record(base: str, name: str, dataset: str, modified: str = "2026-11-06T00:00:00") -> bytes:
    resources = [
        {"id": f"{name}-2025", "url": f"{base}{name}-2025.csv", "last_modified": "2025-11-07T00:00:00", "format": "CSV"},
        {"id": f"{name}-2026", "url": f"{base}{name}-2026.csv", "last_modified": modified, "format": "CSV"},
        {"id": f"{name}-2021e", "url": f"{base}{name}-2021-eng.csv", "last_modified": "2025-11-07T00:00:00", "format": "CSV"},
        {"id": "dd", "url": "https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/cp-pa-dd.xml", "last_modified": None, "format": "XML"},
    ]
    return json.dumps({"success": True, "result": {"id": dataset, "resources": resources}}).encode()


def works_record(modified: str = "2026-11-06T00:00:00") -> bytes:
    return record("https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/atbt-albw/", "atbt-albw", config.PA_WORKS_DATASET, modified)


def services_record(modified: str = "2026-11-06T00:00:00") -> bytes:
    return record("https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/idsps-dipss/", "idsps-dipss", config.PA_SERVICES_DATASET, modified)


def both_client(fake_client, fixtures, works_body: bytes | FakeResponse | None = None):
    wbody = works_body if works_body is not None else (fixtures / "public_accounts_works.csv").read_bytes()
    return fake_client({
        SERVICES_CKAN: services_record(),
        SERVICES_URL: FakeResponse(200, (fixtures / "public_accounts_services.csv").read_bytes(), {"ETag": '"e1"'}),
        WORKS_CKAN: works_record(),
        WORKS_URL: wbody if isinstance(wbody, FakeResponse) else FakeResponse(200, wbody, {"ETag": '"w1"',
                                                                                         "Last-Modified": "Fri, 06 Nov 2026 19:31:36 GMT"}),
    })


def stage(conn, client, tmp_path, now: str = STAMP, families=None):
    kwargs = {} if families is None else {"families": families}
    return pa.run(conn, client, now=now, work_dir=tmp_path / "work", review_dir=tmp_path / "review", **kwargs)


def log_row(conn):
    return conn.execute("SELECT * FROM sources_log WHERE source = 'public_accounts' ORDER BY id DESC").fetchone()


def by_contractor(conn, name: str) -> list:
    return conn.execute("SELECT * FROM pa_works WHERE payee_raw = ? ORDER BY seq", (name,)).fetchall()


# -- reading the file ------------------------------------------------------------------------------------


def test_the_2026_works_layout_reads_contracts_total_rows_and_persons(fixtures, tmp_path):
    parsed = pa.read_works_file(write(tmp_path / "w.csv", works_text(fixtures)), matching.PersonDrops(), withheld=frozenset())
    assert (parsed.fy, parsed.layout, parsed.read, parsed.skipped, parsed.extra) == (2025, "split2026", 18, 0, [])
    kinds = [r.kind for r in parsed.rows]
    assert kinds.count("under") == 3 and kinds.count("withheld") == 3 and kinds.count("named") == 12
    # Every row keeps its number in the file, its key.
    assert [r.seq for r in parsed.rows] == list(range(1, 19))
    first = parsed.rows[0]
    assert (first.dept_no, first.dept_en, first.dept_fr) == ("901", "Department of Exemplar Affairs", "Ministère des Affaires exemplaires")
    assert (first.payee_en, first.city, first.prov, first.desc_en, first.desc_fr, first.proj_city, first.proj_prov) == (
        "Cedarline Analytics Inc", "Ottawa", "Ontario", "Laboratory renewal", "Renouvellement du laboratoire", "Ottawa", "Ontario")
    assert (first.contracted, first.spent_year, first.spent_to_date) == (1_200_000_000, 300_000_000, 900_000_000)
    # A spending below zero is kept as published.
    assert next(r for r in parsed.rows if r.payee_en == "Tidewater Innovate BC").spent_year == -660_600
    # No class blocks in this file.
    assert (parsed.blocks, parsed.blocks_off) == (0, [])


def test_the_total_rows_are_each_departments_line_under_the_threshold(fixtures, tmp_path):
    parsed = pa.read_works_file(write(tmp_path / "w.csv", works_text(fixtures)), matching.PersonDrops(), withheld=frozenset())
    under = [(r.dept_no, r.n_contractors, r.spent_year, r.payee_en, r.desc_en, r.contracted) for r in parsed.rows if r.kind == "under"]
    # "(12 contractors)", "(1 contractor)", "(3 contractors)": the count and the year's spending; no name, no project.
    assert under == [("901", 12, 123_456_700, None, None, 0), ("902", 1, 26_115_400, None, None, 0), ("903", 3, 47_954_100, None, None, 0)]
    assert pa.works_under("Contracts under $250,000 and cost plus contracts under $25,000 (31 contractors)") == (True, 31)
    assert pa.works_under("Contracts under $250,000 and cost plus contracts under $25,000 (1 contractor)") == (True, 1)
    assert pa.works_under("Contrats inférieurs à 250 000 $ et contrats à prix coûtant majoré inférieurs à 25 000 $ (3 entrepreneurs)") == (True, 3)
    assert pa.works_under("Contracts under $250,000") == (True, None)
    assert pa.works_under("Undercroft Contracting Ltd") == (False, None)


def test_rows_without_a_key_are_kept_apart_by_their_order_in_the_file(conn, world, fixtures, tmp_path):
    load_works(conn, fixtures, tmp_path)
    marlowe = by_contractor(conn, "Marlowe Hydrographics Ltd, Ottawa, Ontario")
    # The same department, contractor, description, place and amounts twice: two contracts, rows 3 and 4.
    assert [r["seq"] for r in marlowe] == [3, 4]
    strip = lambda r: {k: r[k] for k in r.keys() if k != "seq"}  # noqa: E731
    assert strip(marlowe[0]) == strip(marlowe[1])


def test_the_swapped_portfolio_columns_are_never_read(fixtures, tmp_path):
    """The 2026 works file writes the French portfolio name in the English column and the other way; a file that puts
    them right reads the same."""
    text = works_text(fixtures)
    fixed = text
    for fr, en in (("Affaires exemplaires", "Exemplar Affairs"), ("Travaux exemplaires", "Sample Works"), ("Ports tranquilles", "Quiet Harbours")):
        fixed = fixed.replace(f",{fr},{en},", f",{en},{fr},")
    assert fixed != text
    a = pa.read_works_file(write(tmp_path / "a.csv", text), matching.PersonDrops(), withheld=frozenset())
    b = pa.read_works_file(write(tmp_path / "b.csv", fixed), matching.PersonDrops(), withheld=frozenset())
    assert a.rows == b.rows


@pytest.mark.parametrize(("prov", "country", "code"), [
    ("Ontario", "", "ON"), ("Québec", "", "QC"), ("Quebec", "", "QC"), ("Nouvelle-Écosse", "", "NS"),
    ("Various provinces", "", None), ("Various Atlantic provinces", "", None), ("Ontario and Quebec", "", None),
    ("Montréal", "", None), ("New York", "United States of America", None), ("", "Germany", None), ("", "", None),
])
def test_the_projects_province_has_a_code_only_when_one_province_is_named(prov, country, code):
    assert pa.project_province(prov, country) == code


def test_the_project_province_codes_stored(conn, world, fixtures, tmp_path):
    load_works(conn, fixtures, tmp_path)
    codes = {r["seq"]: r["proj_prov_code"] for r in works(conn)}
    assert codes[1] == "ON" and codes[10] == "QC" and codes[13] == "BC"
    # "Various provinces", "Ontario and Quebec", a city in the province column, a project abroad: none.
    assert codes[2] is None and codes[3] is None and codes[12] is None and codes[8] is None and codes[14] is None
    various = works(conn, seq=2)[0]
    assert (various["proj_prov"], various["proj_prov_fr"]) == ("Various provinces", "Plusieurs provinces")


def test_a_missing_column_is_refused_before_a_row_is_written(conn, world, fixtures, tmp_path):
    load_works(conn, fixtures, tmp_path)
    before = [tuple(r) for r in works(conn)]
    text = works_text(fixtures).replace("Proj-province_Province-proj_eng", "Proj-region_Region-proj_eng")
    with pytest.raises(contracts.LayoutError, match="lacks Proj-province_Province-proj_eng"):
        pa.read_works_file(write(tmp_path / "cut.csv", text), matching.PersonDrops())
    # A services file in the works file's place has the wrong header set too.
    with pytest.raises(contracts.LayoutError):
        pa.read_works_file(write(tmp_path / "svc.csv", services_text(fixtures)), matching.PersonDrops())
    assert [tuple(r) for r in works(conn)] == before


# -- persons and the contractor's name -------------------------------------------------------------------


def test_a_contractor_named_for_a_person_is_withheld_with_nothing_that_names_or_places_it(conn, world, fixtures, tmp_path):
    drops = matching.PersonDrops()
    load_works(conn, fixtures, tmp_path, drops=drops)
    withheld = works(conn, kind="withheld")
    # The notary's corporation (rule 4), and two persons' names, then three, held in trust (rule 6).
    assert [(r["seq"], r["why"]) for r in withheld] == [(5, "4"), (16, "6"), (17, "6")]
    for r in withheld:
        assert all(r[c] is None for c in NAME_COLS), dict(r)
    # The department and the amounts stay.
    assert [(r["dept_en"], r["contracted"], r["spent_year"], r["spent_to_date"]) for r in withheld] == [
        ("Department of Exemplar Affairs", 41_000_000, 41_000_000, 41_000_000),
        ("Department of Quiet Harbours", 88_000_000, 88_000_000, 88_000_000),
        ("Department of Quiet Harbours", 41_500_000, 41_500_000, 41_500_000)]
    dump = json.dumps([dict(x) for x in works(conn)], ensure_ascii=False)
    for text in (*PERSONS, *PROJECTS):
        assert text not in dump, text
    # The operator's private list has the names, as the other rules' are; nothing else does.
    assert drops.names == ["Quentaro Z Notary Public Inc", "Orrin Vexlor and Mirelle Tansby In Trust",
                           "Orrin Vexlor, Mirelle Tansby and Dace Holmwick In Trust"]


def test_a_firm_held_in_trust_keeps_its_name(conn, world, fixtures, tmp_path):
    load_works(conn, fixtures, tmp_path)
    row = works(conn, seq=6)[0]
    # A legal form beside the trust words, in both languages: the rules keep the name, its place and its project.
    assert (row["kind"], row["why"], row["payee_raw"], row["payee_fr"], row["city"], row["desc_en"]) == (
        "named", "none", "Thrandle Oskeby LLP In Trust", "Thrandle Oskeby S.E.N.C.R.L. en fidéicommis", "Toronto",
        "Acquisition of land")


def test_a_hash_listed_by_hand_withholds_a_contractor_the_rules_keep(conn, world, fixtures, tmp_path, monkeypatch):
    name = "Ferncastle Holdings Ltd"
    assert pa.person_rule(name, name, pa.Places(), ("", "", "", "")) is None
    seed = tmp_path / "withhold.txt"
    seed.write_text(f"# by hand\n{pa.withhold_key(norm_name(name))}\n", encoding="utf-8")
    monkeypatch.setattr(config, "PA_WITHHOLD", seed)
    parsed = pa.read_works_file(write(tmp_path / "w.csv", works_text(fixtures)), matching.PersonDrops())
    row = next(r for r in parsed.rows if r.seq == 10)
    assert (row.kind, row.why, row.payee_en, row.desc_en, row.proj_city) == ("withheld", "seed", None, None, None)
    assert [r.why for r in parsed.rows if r.kind == "withheld"] == ["4", "seed", "6", "6"]
    # The hashes are part of the works rules too.
    before = pa.rules(pa.WORKS)
    seed.write_text("", encoding="utf-8")
    assert pa.rules(pa.WORKS) != before


def test_the_shipped_hash_seed_holds_hashes_only():
    """The seed is public: each line a 32-character hash, every other line a comment."""
    lines = [line for line in config.PA_WITHHOLD.read_text(encoding="utf-8").splitlines() if line.strip()]
    hashes = [line for line in lines if not line.startswith("#")]
    assert hashes and all(len(h) == 32 and all(c in "0123456789abcdef" for c in h) for h in hashes)
    assert pa.read_withheld() == frozenset(hashes)


def test_the_pwgsc_marker_is_dropped_from_a_contractors_name():
    assert pa.drop_marker("Brightwell Consulting Inc **") == "Brightwell Consulting Inc"
    assert pa.drop_marker("Brightwell Consulting Inc**") == "Brightwell Consulting Inc"
    assert pa.drop_marker("Brightwell Consulting Inc") == "Brightwell Consulting Inc"
    assert pa.drop_marker("") == ""


# -- the link -----------------------------------------------------------------------------------------------


def test_the_contractor_link_the_common_name_rule_the_place_flag_and_federal_contractors(conn, world, fixtures, tmp_path):
    before = conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0]
    _, linked = load_works(conn, fixtures, tmp_path)
    cedarline = by_contractor(conn, "Cedarline Analytics Inc")
    assert [(r["seq"], r["organization_id"], r["pf"], r["buyer_id"]) for r in cedarline] == [
        (1, world["Cedarline Analytics Inc"], 0, "exa-aex"), (12, world["Cedarline Analytics Inc"], 0, "sw-te")]
    # The marker is dropped before the name is kept or read; a firm paid in Quebec whose profile is in Ontario is flagged.
    bright = by_contractor(conn, "Brightwell Consulting Inc")
    assert [(r["organization_id"], r["pf"], r["prov_code"]) for r in bright] == [(world["Brightwell Consulting Inc"], 1, "QC")]
    assert conn.execute("SELECT COUNT(*) FROM pa_works WHERE payee_raw LIKE '%*%'").fetchone()[0] == 0
    # The place written after a name is cut before the link.
    marlowe = by_contractor(conn, "Marlowe Hydrographics Ltd, Ottawa, Ontario")
    assert {(r["organization_id"], r["payee_norm"]) for r in marlowe} == {(world["Marlowe Hydrographics Ltd"], "marlowe hydrographics")}
    # One word in another province: not linked. No organization: not linked, never made.
    assert [(r["organization_id"], r["why"]) for r in by_contractor(conn, "Lumenvault")] == [(None, "common")]
    assert [(r["organization_id"], r["why"]) for r in by_contractor(conn, "Ferncastle Holdings Ltd")] == [(None, "none")]
    assert conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0] == before
    # Abroad: linked, the contractor's code XX.
    halden = by_contractor(conn, "Halden Systems AG")[0]
    assert (halden["organization_id"], halden["prov_code"], halden["proj_country"]) == (world["Halden Systems AG"], "XX", "Germany")
    # A federal institution as the contractor names a buyer and no organization.
    fed = works(conn, kind="federal")
    assert [(r["seq"], r["payee_buyer_id"], r["organization_id"]) for r in fed] == [(7, "sw-te", None)]
    assert {r["buyer_id"] for r in works(conn)} == {"exa-aex", "sw-te", "qh-pt"}
    counts = linked.counts[2025]
    assert (counts["rows"], counts["named"], counts["linked"], counts["unlinked"], counts["under"], counts["federal"], counts["flagged"]) == (
        18, 11, 7, 4, 3, 1, 1)
    assert (counts["withheld_4"], counts["withheld_6"]) == (1, 2)


def test_the_nightly_relink_follows_a_merge(conn, world, fixtures, tmp_path):
    load_works(conn, fixtures, tmp_path)
    old = world["Cedarline Analytics Inc"]
    new = org(conn, "Cedarline Analytics Group", "ON")
    conn.execute("INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at, reason) VALUES (?, ?, 3, ?, 'spelling')",
                 (old, new, STAMP))
    conn.execute("DELETE FROM organization_places WHERE organization_id = ?", (old,))
    conn.execute("DELETE FROM organizations WHERE id = ?", (old,))
    conn.commit()
    assert {r["organization_id"] for r in by_contractor(conn, "Cedarline Analytics Inc")} == {None}
    linked = pa.relink(conn, stamp=STAMP, fam=pa.WORKS)
    assert {r["organization_id"] for r in by_contractor(conn, "Cedarline Analytics Inc")} == {new}
    assert linked.changed == 2 and pa.relink(conn, stamp=STAMP, fam=pa.WORKS).changed == 0


def test_a_works_file_applied_again_changes_nothing_and_a_new_copy_replaces_the_year(conn, world, fixtures, tmp_path):
    load_works(conn, fixtures, tmp_path)
    first = [tuple(r) for r in works(conn)]
    load_works(conn, fixtures, tmp_path)
    assert [tuple(r) for r in works(conn)] == first
    text = "\n".join(line for line in works_text(fixtures).split("\n") if "Ferncastle" not in line)
    load_works(conn, fixtures, tmp_path, text)
    assert by_contractor(conn, "Ferncastle Holdings Ltd") == [] and len(works(conn)) == len(first) - 1


# -- the stage, beside the services file -----------------------------------------------------------------


def test_the_stage_reads_both_files_and_logs_each_familys_line(conn, world, fixtures, fake_client, tmp_path):
    client = both_client(fake_client, fixtures)
    calls = client.fake_session.calls
    result = stage(conn, client, tmp_path)
    assert result.state == "read" and result.families["works"].state == "read"
    assert [c[0] for c in calls] == [SERVICES_CKAN, SERVICES_URL, WORKS_CKAN, WORKS_URL]
    row = log_row(conn)
    assert row["ok"] == 1 and row["detail"] == (
        "read fy=2025-26 files=1 rows=29 named=15 linked=7 unlinked=8 withheld=5 federal=2 flagged=1 held=none"
        " | works read fy=2025-26 files=1 rows=18 named=11 linked=7 unlinked=4 withheld=3 federal=1 flagged=1 under=3 held=none")
    assert row["rows_in"] == 29 + 18 and row["excluded"] == 5 + 3
    files = {r["family"]: r for r in conn.execute("SELECT * FROM pa_files")}
    assert set(files) == {"services", "works"}
    w = files["works"]
    assert (w["fy"], w["url"], w["etag"], w["layout"], w["rules"], w["rows"]) == (2025, WORKS_URL, '"w1"', "split2026", pa.rules(pa.WORKS), 18)
    # The works file has rules of its own: a change to the works reading leaves the services file alone.
    assert pa.rules(pa.WORKS) != pa.rules(pa.SERVICES)
    # The next night in the season: both records read, neither file downloaded.
    calls.clear()
    nxt = stage(conn, client, tmp_path, now="2026-11-17T13:00:00Z")
    assert (nxt.state, nxt.families["works"].state) == ("unchanged", "unchanged")
    assert [c[0] for c in calls] == [SERVICES_CKAN, WORKS_CKAN]
    # An hour after a read: not due, no request; the relink runs all the same.
    calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-17T14:00:00Z").families["works"].state == "not due" and calls == []


def test_a_works_record_changed_with_the_same_file_sends_a_conditional_request_and_reads_nothing(conn, world, fixtures, fake_client, tmp_path):
    client = both_client(fake_client, fixtures)
    stage(conn, client, tmp_path)
    applied_at = conn.execute("SELECT applied_at FROM pa_files WHERE family = 'works'").fetchone()[0]
    client.fake_session.mapping[WORKS_CKAN] = works_record(modified="2026-11-07T00:00:00")
    client.fake_session.mapping[WORKS_URL] = FakeResponse(304)
    client.fake_session.calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-17T13:00:00Z").families["works"].state == "unchanged"
    sent = [c for c in client.fake_session.calls if c[0] == WORKS_URL]
    assert sent and sent[0][1].get("If-None-Match") == '"w1"'
    assert conn.execute("SELECT ckan_modified FROM pa_files WHERE family = 'works'").fetchone()[0] == "2026-11-07T00:00:00"
    # The record moves again and the host sends the same bytes: nothing is read or rebuilt.
    client.fake_session.mapping[WORKS_CKAN] = works_record(modified="2026-11-08T00:00:00")
    client.fake_session.mapping[WORKS_URL] = FakeResponse(200, (fixtures / "public_accounts_works.csv").read_bytes(), {"ETag": '"w2"'})
    assert stage(conn, client, tmp_path, now="2026-11-18T13:00:00Z").families["works"].state == "unchanged"
    assert tuple(conn.execute("SELECT applied_at, etag FROM pa_files WHERE family = 'works'").fetchone()) == (applied_at, '"w2"')


def test_a_works_file_the_host_refuses_or_an_unknown_layout_ends_ok_and_leaves_the_services_file_alone(conn, world, fixtures, fake_client, tmp_path):
    # The first night: the works file cannot be fetched; the services file is read.
    client = both_client(fake_client, fixtures, FakeResponse(503))
    result = stage(conn, client, tmp_path)
    row = log_row(conn)
    assert (result.state, result.families["works"].state, row["ok"]) == ("read", "not read", 1)
    assert "public accounts, works: atbt-albw-2026.csv could not be downloaded" in row["notice"]
    assert works(conn) == [] and conn.execute("SELECT COUNT(*) FROM pa_payments").fetchone()[0] == 29
    assert "| works not read fy=none files=0 rows=0" in row["detail"]
    # The record does not answer: a notice, nothing else.
    client.fake_session.mapping[WORKS_CKAN] = FakeResponse(500)
    result = stage(conn, client, tmp_path, now="2026-11-17T13:00:00Z")
    assert result.families["works"].state == "not read" and "public accounts, works: the dataset record could not be read" in log_row(conn)["notice"]
    # The file arrives and is read.
    client.fake_session.mapping[WORKS_CKAN] = works_record()
    client.fake_session.mapping[WORKS_URL] = FakeResponse(200, (fixtures / "public_accounts_works.csv").read_bytes(), {"ETag": '"w1"'})
    assert stage(conn, client, tmp_path, now="2026-11-18T13:00:00Z").families["works"].state == "read"
    before = [tuple(r) for r in works(conn)]
    services_before = [tuple(r) for r in conn.execute("SELECT * FROM pa_payments ORDER BY seq")]
    # A new copy whose header set is not the layout's: refused, the rows applied before stand, and it is not
    # downloaded again while the record lists the same copy.
    client.fake_session.mapping[WORKS_CKAN] = works_record(modified="2026-11-09T00:00:00")
    changed = works_text(fixtures).replace("Proj-desc_eng", "Proj-description_eng").encode("utf-8")
    client.fake_session.mapping[WORKS_URL] = FakeResponse(200, changed)
    result = stage(conn, client, tmp_path, now="2026-11-19T13:00:00Z")
    row = log_row(conn)
    assert (result.families["works"].state, row["ok"]) == ("refused", 1) and "lacks Proj-desc_eng" in row["notice"]
    client.fake_session.calls.clear()
    assert stage(conn, client, tmp_path, now="2026-11-20T13:00:00Z").families["works"].state == "refused"
    assert WORKS_URL not in [c[0] for c in client.fake_session.calls] and "held=layout" in log_row(conn)["detail"].split(" | works ")[1]
    assert [tuple(r) for r in works(conn)] == before
    assert [tuple(r) for r in conn.execute("SELECT * FROM pa_payments ORDER BY seq")] == services_before
    # The services file's own hold is untouched by the works file's.
    assert pa.held_copy(conn) is None and pa.held_copy(conn, pa.WORKS)["why"].startswith("layout")
    assert all(r["ok"] == 1 for r in conn.execute("SELECT ok FROM sources_log WHERE source = 'public_accounts'"))


def test_a_works_copy_with_far_fewer_rows_is_held(conn, world, fixtures, fake_client, tmp_path, monkeypatch):
    client = both_client(fake_client, fixtures)
    stage(conn, client, tmp_path)
    before = [tuple(r) for r in works(conn)]
    lines = works_text(fixtures).split("\n")
    short = "\n".join([lines[0], *[line for line in lines[1:] if ",902," in line]]) + "\n"
    client.fake_session.mapping[WORKS_CKAN] = works_record(modified="2026-11-09T00:00:00")
    client.fake_session.mapping[WORKS_URL] = FakeResponse(200, short.encode("utf-8"))
    monkeypatch.setattr(config, "PA_RELEASE", tmp_path / "release.txt")
    result = stage(conn, client, tmp_path, now="2026-11-17T13:00:00Z")
    assert result.families["works"].state == "held" and "more than 30 percent fewer" in log_row(conn)["notice"]
    assert [tuple(r) for r in works(conn)] == before
    held = pa.held_copy(conn, pa.WORKS)
    (tmp_path / "release.txt").write_text(held["sha256"][:12] + "\n", encoding="utf-8")
    assert stage(conn, client, tmp_path, now="2026-11-18T13:00:00Z").families["works"].state == "read"


def test_a_change_of_the_works_rules_reads_the_works_file_again_and_not_the_services_file(conn, world, fixtures, fake_client, tmp_path, monkeypatch):
    client = both_client(fake_client, fixtures)
    stage(conn, client, tmp_path)
    monkeypatch.setattr(pa, "WORKS_RULES_VERSION", pa.WORKS_RULES_VERSION + 1)
    client.fake_session.calls.clear()
    result = stage(conn, client, tmp_path, now="2026-11-16T14:00:00Z")
    assert (result.state, result.families["works"].state) == ("not due", "read")
    assert [c[0] for c in client.fake_session.calls] == [WORKS_URL]


def test_names_never_reach_the_log_and_the_works_review_files(conn, world, fixtures, fake_client, tmp_path):
    stage(conn, both_client(fake_client, fixtures), tmp_path)
    for row in conn.execute("SELECT detail, notice FROM sources_log"):
        text = (row["detail"] or "") + (row["notice"] or "")
        for name in PERSONS:
            assert name not in text
    review = (tmp_path / "review" / pa.WORKS.review_file).read_text(encoding="utf-8")
    for name in PERSONS:
        assert name not in review
    assert "acquisition of land, buildings and works" in review and "Lumenvault" in review and "## Federal contractors by the strict test: 1" in review
    assert b"\r" not in (tmp_path / "review" / pa.WORKS.review_file).read_bytes()
    # The counts by rule have a column for each of the six rules and the hand-kept hashes.
    lines = review.split("\n")
    at = next(i for i, line in enumerate(lines) if line.startswith("## Counts by fiscal year"))
    head = lines[at + 1].split("\t")
    counts = dict(zip(head[1:], lines[at + 2].split("\t")[1:]))
    assert [k for k in head if k.startswith("withheld_")] == [f"withheld_{n}" for n in (1, 2, 3, 4, 5, 6, "seed")]
    assert (counts["withheld_4"], counts["withheld_6"], counts["withheld_seed"]) == ("1", "2", "0")
    persons = (tmp_path / "review" / pa.WORKS.persons_file).read_text(encoding="utf-8")
    assert "Quentaro Z Notary Public Inc" in persons and "no step exports, logs or uploads it" in persons
    assert "Orrin Vexlor and Mirelle Tansby In Trust" in persons and "Dace Holmwick In Trust" in persons
    # The services file's own review is its own.
    assert "acquisition of land" not in (tmp_path / "review" / pa.REVIEW_FILE).read_text(encoding="utf-8")


def test_a_samples_run_reads_both_samples_and_makes_no_request(conn, world, fixtures, tmp_path, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("a samples run made a request")

    monkeypatch.setattr(cli, "PoliteClient", no_network)
    shutil.copy(fixtures / "public_accounts_services.csv", tmp_path / pa.SAMPLE_NAME)
    assert cli.run(conn, ["public_accounts"], samples=tmp_path) == 0
    assert "no pa-works.csv in the samples folder" in log_row(conn)["notice"]
    shutil.copy(fixtures / "public_accounts_works.csv", tmp_path / pa.WORKS.sample_name)
    assert cli.run(conn, ["public_accounts"], samples=tmp_path) == 0
    assert "| works read fy=2025-26" in log_row(conn)["detail"]


def test_the_newest_works_file_is_the_one_read():
    res = pa.newest_resource(json.loads(works_record()), pa.WORKS)
    assert (res.fy, res.url, res.resource_id, res.lang, res.file) == (2025, WORKS_URL, "atbt-albw-2026", "", "atbt-albw-2026.csv")
    # The services record lists no works file, and the other way.
    assert pa.newest_resource(json.loads(services_record()), pa.WORKS) is None
    assert pa.newest_resource(json.loads(works_record()), pa.SERVICES) is None


def test_the_works_record_has_its_own_cadence(conn):
    assert pa.ckan_due(conn, STAMP, pa.WORKS)
    set_meta(conn, pa.WORKS.meta_checked, "2026-11-16T13:00:00Z")
    assert not pa.ckan_due(conn, "2026-11-16T20:00:00Z", pa.WORKS) and pa.ckan_due(conn, "2026-11-17T13:00:00Z", pa.WORKS)
    # The services record's own time is apart.
    assert pa.ckan_due(conn, "2026-11-16T20:00:00Z", pa.SERVICES)
    assert pa.WORKS.meta_checked != pa.META_CHECKED and pa.WORKS.meta_hold != pa.META_HOLD


# -- what the export writes -------------------------------------------------------------------------------


NAMES = {"exa-aex": ("Exemplar Affairs Canada", "Affaires exemplaires Canada"), "sw-te": ("Sample Works Canada", "Travaux exemplaires Canada"),
         "qh-pt": ("Quiet Harbours Canada", "Ports tranquilles Canada")}
LISTED = set(NAMES)


def test_the_profile_block_carries_the_works_rows_largest_contract_first(conn, world, fixtures, tmp_path, monkeypatch):
    load_works(conn, fixtures, tmp_path)
    orgs = set(world.values())
    blocks = pa.profile_blocks(conn, orgs=orgs, listed=LISTED, buyer_names=NAMES)
    assert set(blocks) == {world[n] for n in ("Cedarline Analytics Inc", "Marlowe Hydrographics Ltd", "Brightwell Consulting Inc",
                                                "Tidewater Innovate BC", "Halden Systems AG")}
    cedarline = blocks[world["Cedarline Analytics Inc"]]
    assert cedarline == {
        "v": 1,
        "services": [],
        "works": [{"fy": 2025, "n": 2, "rows": [
            ["sw-te", 25_000_000, 5_000_000, 20_000_000, "Cedarline Analytics Inc", None, "Ottawa", None, "ON",
             "Wharf repairs", "Réparation du quai", "Montréal", None, ["Montréal", "Québec"], 0],
            ["exa-aex", 12_000_000, 3_000_000, 9_000_000, "Cedarline Analytics Inc", None, "Ottawa", None, "ON",
             "Laboratory renewal", "Renouvellement du laboratoire", "Ottawa", None, "ON", 0],
        ]}],
        "buyers": {"exa-aex": list(NAMES["exa-aex"]), "sw-te": list(NAMES["sw-te"])},
        "classes": {},
        "loaded": [2025, 2025],
    }
    bright = blocks[world["Brightwell Consulting Inc"]]["works"][0]["rows"][0]
    assert bright[4] == "Brightwell Consulting Inc" and bright[11:] == ["Various locations", "Divers endroits",
                                                                          ["Various provinces", "Plusieurs provinces"], 1]
    halden = blocks[world["Halden Systems AG"]]["works"][0]["rows"][0]
    assert halden[8] == ["Germany", "Allemagne"] and halden[13] == ["Germany", "Allemagne"]
    marlowe = blocks[world["Marlowe Hydrographics Ltd"]]["works"][0]
    assert marlowe["n"] == 2 and len(marlowe["rows"]) == 2
    # No total of any kind in the works part.
    for block in blocks.values():
        for year in block["works"]:
            assert set(year) == {"fy", "n", "rows"}
    monkeypatch.setattr(pa, "PA_PROFILE_ROWS", 1)
    capped = pa.profile_blocks(conn, orgs=orgs, listed=LISTED, buyer_names=NAMES)[world["Cedarline Analytics Inc"]]["works"][0]
    assert (capped["n"], len(capped["rows"])) == (2, 1)
    assert pa.profile_blocks(conn, orgs=orgs, listed=LISTED, buyer_names=NAMES) == pa.profile_blocks(conn, orgs=orgs, listed=LISTED,
                                                                                                         buyer_names=NAMES)


def test_the_buyer_block_carries_the_works_contracts_and_the_line_under_the_threshold(conn, world, fixtures, tmp_path):
    load_works(conn, fixtures, tmp_path)
    blocks = pa.buyer_blocks(conn, orgs=set(world.values()), listed=LISTED)
    exa = blocks["exa-aex"]
    # A department with no services file applied: an empty services part, and the works.
    assert {k: exa[k] for k in ("v", "fy", "classes", "payees", "named_rows", "years")} == {
        "v": 1, "fy": 2025, "classes": [], "payees": [], "named_rows": 0, "years": []}
    w = exa["works"]
    assert (w["fy"], w["n"], w["under"]) == (2025, 9, [12, 1_234_567])
    assert [r[0] for r in w["rows"]] == ["Cedarline Analytics Inc", "Halden Systems AG", "Brightwell Consulting Inc",
                                         "Thrandle Oskeby LLP In Trust", "Department of Sample Works",
                                         "Marlowe Hydrographics Ltd, Ottawa, Ontario", "Marlowe Hydrographics Ltd, Ottawa, Ontario",
                                         "Lumenvault", "Ferncastle Holdings Ltd"]
    assert w["rows"][0] == ["Cedarline Analytics Inc", None, world["Cedarline Analytics Inc"], "Ottawa", None, "ON", "Laboratory renewal",
                            "Renouvellement du laboratoire", "Ottawa", None, "ON", 12_000_000, 3_000_000, 9_000_000, 0]
    # A federal contractor is listed with no profile and marked as one; an unlinked contractor has no profile either.
    assert w["rows"][4][:3] == ["Department of Sample Works", "Ministère des Travaux exemplaires", None] and w["rows"][4][14] == 1
    # A firm held in trust is listed under its name, as written in both languages.
    assert w["rows"][3][1] == "Thrandle Oskeby S.E.N.C.R.L. en fidéicommis" and w["rows"][3][2] is None and w["rows"][3][14] == 0
    assert [r[14] for r in w["rows"]].count(1) == 1
    assert blocks["sw-te"]["works"]["under"] == [1, 261_154]
    assert [r[0] for r in blocks["sw-te"]["works"]["rows"]] == ["Cedarline Analytics Inc", "Nordwave SIA", "Tidewater Innovate BC"]
    assert blocks["sw-te"]["works"]["rows"][2][12] == -6_606
    # A department whose contracts are all withheld (persons held in trust): its line under the threshold alone.
    assert blocks["qh-pt"]["works"] == {"fy": 2025, "n": 0, "rows": [], "under": [3, 479_541]}
    for block in blocks.values():
        assert set(block["works"]) == {"fy", "n", "rows", "under"}
    # The notary's corporation and the persons held in trust are withheld; nothing of their rows is listed.
    dump = json.dumps(blocks, ensure_ascii=False)
    for text in (*PERSONS, *PROJECTS, "880000", "415000"):
        assert text not in dump, text
    assert pa.buyer_blocks(conn, orgs=set(), listed=set()) == {}


def test_the_buyer_block_lists_the_25_largest_contracts(conn, world, fixtures, tmp_path):
    lines = works_text(fixtures).rstrip("\n").split("\n")
    template = next(line for line in lines if "Ferncastle" in line)
    extra = [template.replace("Ferncastle Holdings Ltd", f"Kestrel Works {i} Ltd").replace(",30000,30000,30000", f",{1_000_000 + i},0,0")
             for i in range(30)]
    load_works(conn, fixtures, tmp_path, "\n".join([*lines, *extra]) + "\n")
    w = pa.buyer_blocks(conn, orgs=set(world.values()), listed=LISTED)["exa-aex"]["works"]
    assert pa.PA_BUYER_WORKS == 25 and w["n"] == 39 and len(w["rows"]) == 25
    contracted = [r[11] for r in w["rows"]]
    assert contracted == sorted(contracted, reverse=True) and contracted[0] == 12_000_000


def test_works_are_never_summed_with_the_services_payments(conn, world, fixtures, tmp_path):
    """The services part of each block is the same with and without the works file; the works part has no total."""
    load_services(conn, fixtures, tmp_path)
    orgs = set(world.values())
    services_profiles = pa.profile_blocks(conn, orgs=orgs, listed=LISTED, buyer_names=NAMES)
    services_buyers = pa.buyer_blocks(conn, orgs=orgs, listed=LISTED)
    # With the services file alone no block has a works key: each is the block slice 1 wrote.
    assert services_profiles and all("works" not in b for b in [*services_profiles.values(), *services_buyers.values()])
    load_works(conn, fixtures, tmp_path)
    profiles = pa.profile_blocks(conn, orgs=orgs, listed=LISTED, buyer_names=NAMES)
    buyers_ = pa.buyer_blocks(conn, orgs=orgs, listed=LISTED)
    for oid, before in services_profiles.items():
        after = profiles[oid]
        assert after["services"] == before["services"] and after["classes"] == before["classes"], oid
    for bid, before in services_buyers.items():
        after = buyers_[bid]
        assert {k: v for k, v in after.items() if k != "works"} == before, bid
    # Cedarline has both: two parts side by side, nothing joining them.
    cedar = profiles[world["Cedarline Analytics Inc"]]
    assert cedar["services"][0]["total"] == 3_195_000 and "total" not in cedar["works"][0]
    assert set(cedar) == {"v", "services", "works", "buyers", "classes", "loaded"}
    exa = buyers_["exa-aex"]
    assert exa["years"] == services_buyers["exa-aex"]["years"] and "total" not in exa["works"]


def _builders(conn, orgs):
    """The two builders as export_static calls them: one function with a works switch, called twice."""
    return {"profiles": lambda works: pa.profile_blocks(conn, orgs=orgs, listed=LISTED, buyer_names=NAMES, works=works),
            "buyer files": lambda works: pa.buyer_blocks(conn, orgs=orgs, listed=LISTED, works=works)}


def _export_rows(conn) -> list:
    return conn.execute("SELECT ok, detail, notice FROM sources_log WHERE source = 'export_public_accounts' ORDER BY id").fetchall()


def test_works_false_reads_nothing_of_the_works_file_and_is_the_block_slice_1_wrote(conn, world, fixtures, tmp_path):
    load_services(conn, fixtures, tmp_path)
    orgs = set(world.values())
    build = _builders(conn, orgs)
    # Before the works file: what slice 1 returned.
    before = {what: json.dumps(b(True), ensure_ascii=False) for what, b in build.items()}
    load_works(conn, fixtures, tmp_path)
    sql: list[str] = []
    conn.set_trace_callback(sql.append)
    try:
        without = {what: json.dumps(b(False), ensure_ascii=False) for what, b in build.items()}
    finally:
        conn.set_trace_callback(None)
    assert without == before
    assert sql and not any("pa_works" in s or "'works'" in s for s in sql), sql
    # With the works file, the same call with works on carries the works part.
    assert "works" in build["profiles"](True)[world["Cedarline Analytics Inc"]] and "works" in build["buyer files"](True)["exa-aex"]


def test_a_fault_in_the_works_part_leaves_the_services_payments_in_the_export(conn, world, fixtures, tmp_path, monkeypatch):
    load_services(conn, fixtures, tmp_path)
    load_works(conn, fixtures, tmp_path)
    orgs = set(world.values())
    build = _builders(conn, orgs)
    expected = {what: json.dumps(b(False), ensure_ascii=False) for what, b in build.items()}
    real = pa.loaded_years

    def broken(conn_, fam=None):
        if fam is not None and fam.name == pa.WORKS.name:
            raise RuntimeError("works years unreadable")
        return real(conn_, fam)

    monkeypatch.setattr(pa, "loaded_years", broken)
    for what, b in build.items():
        got = export_static.public_accounts_blocks(conn, what, lambda b=b: b(True), lambda b=b: b(False))
        # The services part, byte for byte what works=False returns, and no works key anywhere.
        assert json.dumps(got, ensure_ascii=False) == expected[what], what
        assert got and all("works" not in block for block in got.values())
    rows_ = _export_rows(conn)
    assert [r["ok"] for r in rows_] == [1, 1]
    assert [r["notice"] for r in rows_] == [
        f"the Public Accounts works contracts were left out of the {what} tonight (RuntimeError: works years unreadable)"
        for what in ("profiles", "buyer files")]
    assert not any("payments were left out" in r["notice"] for r in rows_)


def test_a_fault_in_both_parts_leaves_the_block_out_and_no_fault_writes_no_row(conn, world, fixtures, tmp_path, monkeypatch):
    load_services(conn, fixtures, tmp_path)
    load_works(conn, fixtures, tmp_path)
    build = _builders(conn, set(world.values()))
    # No fault: the full block, works part and all, and no row.
    for what, b in build.items():
        assert export_static.public_accounts_blocks(conn, what, lambda b=b: b(True), lambda b=b: b(False)) == b(True)
    assert _export_rows(conn) == []

    def broken(*args, **kwargs):
        raise ValueError("no years")

    monkeypatch.setattr(pa, "loaded_years", broken)
    assert export_static.public_accounts_blocks(conn, "profiles", lambda: build["profiles"](True), lambda: build["profiles"](False)) == {}
    notices = [r["notice"] for r in _export_rows(conn)]
    # The existing notice says the block is out; the works notice before it says the first build failed.
    assert notices == ["the Public Accounts works contracts were left out of the profiles tonight (ValueError: no years)",
                       "the Public Accounts payments were left out of the profiles tonight (ValueError: no years)"]
    assert all(r["ok"] == 1 for r in _export_rows(conn))


def test_no_other_module_reads_the_works_rows():
    package = Path(pa.__file__).resolve().parents[1]
    readers = sorted(p.relative_to(package).as_posix() for p in package.rglob("*.py") if "pa_works" in p.read_text(encoding="utf-8"))
    assert readers == ["sources/public_accounts.py"]
    for schema in ("records_schema.sql", "search_schema.sql", "intraday_schema.sql"):
        assert "pa_works" not in (package.parent / schema).read_text(encoding="utf-8"), schema


def test_the_data_page_lists_the_works_file(conn, world, fixtures, tmp_path):
    rows_ = [r for r in export_static.source_files(conn) if r["source"] == "pa_works"]
    assert rows_ == [{"source": "pa_works", "file": "atbt-albw", "last_read": None, "last_modified": None,
                      "last_modified_http": None, "loaded": False}]
    load_works(conn, fixtures, tmp_path)
    rows_ = [r for r in export_static.source_files(conn) if r["source"] == "pa_works"]
    assert rows_ == [{"source": "pa_works", "file": "atbt-albw-2026.csv", "last_read": STAMP, "last_modified": "2026-11-06T19:31:36Z",
                      "last_modified_http": "Fri, 06 Nov 2026 19:31:36 GMT", "loaded": True}]
    order = [r["source"] for r in export_static.source_files(conn)]
    assert order.index("pa_works") == order.index("pa_services") + 1


def test_the_site_holds_the_same_figures_for_the_works():
    site = Path(pa.__file__).resolve().parents[3] / "site" / "src"
    text = (site / "public_accounts.tsx").read_text(encoding="utf-8")
    assert f"export const PA_BUYER_WORKS = {pa.PA_BUYER_WORKS};" in text
    assert f'export const PA_WORKS_DATASET = "{config.PA_WORKS_DATASET}";' in text


def test_an_export_with_the_works_file_changes_only_its_own_blocks(conn, tmp_path, monkeypatch):
    """No works figure meets a contract value: an export with a works file applied is byte for byte the export without
    it (the static tree, the CSV downloads, the organizations' totals and years, the buyers' years), apart from the
    profiles and the buyer file the works rows name and stats.json's rows of files read. A fault in the works part at
    export time takes the works part out at both call sites and nothing else."""
    import csv
    import io

    from awardwatch_pipeline import export, indicators, organizations
    from awardwatch_pipeline import export_static as es
    from export_seed import ACME, NORTH, TODAY, seed

    ids = seed(conn)
    conn.execute("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES ('National Defence', 'ckan', 'dnd-mdn')")
    conn.commit()

    def snapshot(name: str):
        out = tmp_path / name
        es.export_static(conn, out / "static", today=TODAY, base_url="https://awardwatch.example")
        export.export_csv(conn, out / "csv", today=TODAY)
        files = {p.relative_to(out).as_posix(): p.read_bytes() for p in out.rglob("*") if p.is_file()}
        tables = {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY 1, 2, 3")]
                  for t in ("organizations", "organization_years", "buyer_years")}
        return files, tables

    before, before_tables = snapshot("without")
    head = works_text(Path(__file__).parent / "fixtures").split("\n", 1)[0].split(",")
    dept = ["2025/2026", "11", "Défense nationale", "National Defence", "018", "Department of National Defence",
            "Ministère de la Défense nationale"]
    place = ["Ottawa", "Ottawa", "Ontario", "Ontario", "", ""]
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(head)
    writer.writerows([
        [*dept, ACME, ACME, *place, "Hangar", "Hangar", "Petawawa", "Petawawa", "Ontario", "Ontario", "", "", 9000000, 1000000, 4000000],
        [*dept, NORTH, NORTH, *place, "Jetty", "Jetée", "Esquimalt", "Esquimalt", "British Columbia", "Colombie-Britannique", "", "",
         500000, 0, 0],
        [*dept, "Contracts under $250,000 and cost plus contracts under $25,000 (4 contractors)",
         "Contrats inférieurs à 250 000 $ et contrats à prix coûtant majoré inférieurs à 25 000 $ (4 entrepreneurs)",
         "", "", "", "", "", "", "Total", "Total", "", "", "", "", "", "", 0, 300000, 0],
    ])
    path = write(tmp_path / "works.csv", out.getvalue())
    parsed = pa.read_works_file(path, matching.PersonDrops(), withheld=frozenset())
    assert [r.kind for r in parsed.rows] == ["named", "named", "under"]
    pa.apply(conn, parsed, pa.Resource(fy=2025, url="https://example.invalid/atbt-albw-2026.csv", resource_id="r", ckan_modified=None),
             digest=contracts.sha256(path), etag=None, last_modified=None, stamp="2026-10-31T02:00:00Z", fam=pa.WORKS)
    assert {r[0] for r in conn.execute("SELECT organization_id FROM pa_works WHERE kind = 'named'")} == {ids[ACME], ids[NORTH]}
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
    shard = next(s for s in shards if es.shard_key(ids[ACME]) in s)
    profile = json.loads(after[shard])[ids[ACME]]
    assert profile["public_accounts"]["services"] == [] and profile["public_accounts"]["works"][0]["rows"][0][:4] == [
        "dnd-mdn", 9_000_000, 1_000_000, 4_000_000]
    assert profile["organization"] == json.loads(before[shard])[ids[ACME]]["organization"]
    buyer = json.loads(after["static/buyers/dnd-mdn.json"])["public_accounts"]
    assert buyer["works"]["under"] == [4, 300_000] and buyer["classes"] == [] and buyer["years"] == []
    stats_a, stats_b = json.loads(before["static/stats.json"]), json.loads(after["static/stats.json"])
    for doc in (stats_a, stats_b):
        doc.pop("runs")
    files_b, files_a = stats_b.pop("sources"), stats_a.pop("sources")
    assert stats_a == stats_b
    assert [r for r in files_b if r["source"] != "pa_works"] == [r for r in files_a if r["source"] != "pa_works"]
    assert [r["file"] for r in files_b if r["source"] == "pa_works"] == ["atbt-albw-2026.csv"]

    # The works part faults: each call site builds its blocks again without it. No services file is applied here,
    # so the profiles and the buyer file are then the export without the works file, byte for byte, and each call
    # site leaves a works notice and no payments notice.
    real = pa.loaded_years

    def broken(conn_, fam=None):
        if fam is not None and fam.name == pa.WORKS.name:
            raise RuntimeError("works years unreadable")
        return real(conn_, fam)

    monkeypatch.setattr(pa, "loaded_years", broken)
    faulted, _ = snapshot("faulted")
    for name in [*shards, "static/buyers/dnd-mdn.json"]:
        assert faulted[name] == before[name], name
    notices = [r[0] for r in conn.execute("SELECT notice FROM sources_log WHERE source = 'export_public_accounts' ORDER BY id")]
    assert sorted(notices) == [f"the Public Accounts works contracts were left out of the {what} tonight (RuntimeError: works "
                               "years unreadable)" for what in ("buyer files", "profiles")]
