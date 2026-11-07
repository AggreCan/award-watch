"""merges.py, run inside the organizations stage: a shared business number, a name cut at 35 characters,
the reviewed seed and its keep-apart rows, survivors that do not flip, merges undone when their evidence
goes, the aliases the site redirects by, and the names that are not organizations."""

import json
from datetime import date

import pytest

from awardwatch_pipeline import export_static, merges, organizations
from awardwatch_pipeline.normalize import norm_name, org_id

T1, T2, T3, T4 = "2026-10-31T00:00:00Z", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z"
IBM_BN = "102444452"


@pytest.fixture
def seed_file(tmp_path, monkeypatch):
    """An empty seed file in place of the committed one; write(rows) fills it."""
    path = tmp_path / "organization_aliases.csv"

    def write(*rows: tuple[str, str, str]) -> None:
        path.write_text("from_norm,to_norm,reason\n" + "".join(f"{a},{b},{c}\n" for a, b, c in rows), encoding="utf-8")

    write()
    monkeypatch.setattr(merges, "SEED_PATH", path)
    return write


@pytest.fixture
def shadow(monkeypatch):
    """The spelling rule in shadow, for the tests about the other rules and the seed: on (the default since
    2026-11-07) it would merge their spacing variants before the seed is read."""
    monkeypatch.setattr(merges.config, "ORG_SPELLING_MERGE", "shadow")


def contract(conn, ref, name, *, value=1000.0, owner="dept-x"):
    oid = organizations.upsert(conn, name, source="contracts", country="CA", postal_code="K1A 0B1")
    conn.execute("INSERT INTO contracts (owner_org, reference, vendor_raw, vendor_country, value, contract_date, "
                 "organization_id, loaded_at) VALUES (?, ?, ?, 'CA', ?, '2025-06-01', ?, ?)",
                 (owner, ref, name, value, oid, T1))
    return oid


def award(conn, ref, name, *, value=1000.0):
    oid = organizations.upsert(conn, name, source="awards", country="CA", province="ON")
    conn.execute("INSERT INTO awards (reference, amendment, supplier_raw, supplier_country, organization_id, amount, "
                 "total_value, currency, status, awarded, source_file, first_seen, last_seen) "
                 "VALUES (?, 0, ?, 'CA', ?, ?, ?, 'CAD', 'active', '2025-01-01', 'f', '2026-10-31', '2026-10-31')",
                 (ref, name, oid, value, value))
    return oid


def grant(conn, ref, name, *, bn, value=500.0, city=None):
    oid = organizations.upsert(conn, name, source="grants", country="CA", province="ON", city=city)
    conn.execute("INSERT INTO grants (owner_org, reference, amendment, legal_name, business_number, value, start, "
                 "city, organization_id, loaded_at) VALUES ('dept-g', ?, 0, ?, ?, ?, '2024-04-01', ?, ?, ?)",
                 (ref, name, bn, value, city, oid, T1))
    return oid


def records_of(conn, oid):
    return sum(conn.execute(f"SELECT COUNT(*) FROM {t} WHERE organization_id = ?", (oid,)).fetchone()[0]
               for t in organizations.RECORD_TABLES)


def aliases(conn):
    return {r[0]: (r[1], r[2]) for r in conn.execute("SELECT old_id, new_id, reason FROM organization_aliases")}


def run(conn, tmp_path, now=T1):
    return organizations.run(conn, now=now, review_dir=tmp_path / "review")


def test_organizations_sharing_a_business_number_merge_into_the_one_with_most_records(conn, tmp_path, seed_file):
    ltd = contract(conn, "C1", "IBM CANADA LTD.")
    contract(conn, "C2", "IBM Canada Ltd")
    grant(conn, "G1", "IBM CANADA LTD.", bn=IBM_BN)
    bilingual = award(conn, "A1", "IBM CANADA LIMITED/IBM CANADA LIMITÉE")
    # Another spelling of the bilingual name, with the number and its program account.
    assert grant(conn, "G2", "IBM Canada Limited - IBM Canada Ltée", bn=IBM_BN + "RC0001") == bilingual
    other = grant(conn, "G3", "Unrelated Widgets Inc.", bn="100458652")
    assert ltd != bilingual
    result = run(conn, tmp_path)
    assert result["merged_business_number"] == 1
    assert records_of(conn, ltd) == 5 and records_of(conn, bilingual) == 0 and records_of(conn, other) == 1
    assert aliases(conn) == {bilingual: (ltd, "business_number")}
    ids = {r[0] for r in conn.execute("SELECT id FROM organizations")}
    assert bilingual not in ids and ltd in ids
    row = conn.execute("SELECT display_name, business_number, n_awards, n_grants FROM organizations WHERE id = ?",
                       (ltd,)).fetchone()
    assert tuple(row) == ("IBM CANADA LTD.", IBM_BN, 1, 2)
    # The merged spellings are the profile's other spellings.
    names = {r[0] for r in conn.execute("SELECT raw_name FROM organization_names WHERE organization_id = ?", (ltd,))}
    assert "IBM CANADA LIMITED/IBM CANADA LIMITÉE" in names
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert f"business_number\t{bilingual}\tIBM CANADA LIMITED/IBM CANADA LIMITÉE\t2\t{ltd}\tIBM CANADA LTD.\t3\t{IBM_BN}" \
        in review
    log = conn.execute("SELECT detail, notice FROM sources_log WHERE source = 'organizations'").fetchone()
    assert "merged_business_number=1" in log["detail"] and merges.REVIEW_FILE in log["notice"]


def test_a_shared_number_needs_a_word_or_a_place_in_common(conn, tmp_path, seed_file):
    # A grant row that carries another recipient's number (the Dairy Processing Investment Fund rows of 2019-2020).
    saputo = grant(conn, "G1", "Saputo Foods Limited", bn="717818090", city="Saint-Laurent")
    contract(conn, "C1", "Saputo Foods Limited")
    cheese = grant(conn, "G2", "Fromagerie au Gré Des Champs Inc.", bn="717818090", city="Saint-Jean-sur-Richelieu")
    # A rename: no word in common, the same city.
    new = grant(conn, "G3", "Toronto Metropolitan University", bn="108162330", city="Toronto")
    contract(conn, "C2", "Toronto Metropolitan University")
    old = grant(conn, "G4", "Ryerson University", bn="108162330", city="TORONTO")
    result = run(conn, tmp_path)
    assert result["merged_business_number"] == 1 and result["merge_review"] == 1
    assert aliases(conn) == {old: (new, "business_number")}
    assert records_of(conn, saputo) == 2 and records_of(conn, cheese) == 1
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert (f"{cheese}\tFromagerie au Gré Des Champs Inc.\t1\tbusiness number 717818090 shared with no word or place "
            f"in common\t{saputo} Saputo Foods Limited") in review


def test_a_name_cut_at_35_characters_joins_the_one_name_it_continues(conn, tmp_path, seed_file):
    cut = contract(conn, "C1", "HEARTZAP SAFETY TRAINING & EQUIPMEN")
    contract(conn, "C2", "Heartzap Safety Training & Equipmen")
    full = award(conn, "A1", "HEARTZAP SAFETY TRAINING AND EQUIPMENT")
    # A whole name of 35 characters that another name only extends at a word: never a cut.
    whole = contract(conn, "C3", "MEMORIAL UNIVERSITY OF NEWFOUNDLAND")
    garden = award(conn, "A2", "Memorial University of Newfoundland Botanical Garden Inc.")
    result = run(conn, tmp_path)
    assert result["merged_truncation"] == 1 and result["merge_review"] == 0
    assert aliases(conn) == {cut: (full, "truncation")}
    assert records_of(conn, full) == 3 and records_of(conn, whole) == 1 and records_of(conn, garden) == 1
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert f"truncation\t{cut}\t" in review and "HEARTZAP SAFETY TRAINING & EQUIPMEN" in review


def test_a_cut_name_with_two_candidates_or_a_joint_venture_is_left_for_review(conn, tmp_path, seed_file):
    bell = contract(conn, "C1", "The Bell Telephone Company of Canad")
    one = award(conn, "A1", "The Bell Telephone Company of Canada")
    two = award(conn, "A2", "The Bell Telephone Company of Canada or Bell Canada")
    firm = contract(conn, "C2", "ROBERTSON MARTIN ARCHITECTS INCORPO")
    jv = award(conn, "A3", "Robertson Martin Architects Incorporated, Roderick Lahey Architect Inc., IN JOINT VENTURE")
    result = run(conn, tmp_path)
    assert result["merged"] == 0 and result["merge_review"] == 2
    assert aliases(conn) == {}
    assert all(records_of(conn, o) == 1 for o in (bell, one, two, firm, jv))
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert f"{bell}\tThe Bell Telephone Company of Canad\t1\t2 candidates\t" in review
    assert f"{firm}\tROBERTSON MARTIN ARCHITECTS INCORPO\t1\ta candidate names a joint venture\t{jv}" in review


def test_the_seed_merges_by_hand_and_an_empty_to_norm_keeps_an_organization_apart(conn, tmp_path, seed_file, shadow):
    coradix = contract(conn, "C1", "CORADIX TECHNOLOGY CONSULTING LTD.")
    contract(conn, "C2", "CORADIX TECHNOLOGY CONSULTING LTD.")
    typo = contract(conn, "C3", "CoradixTechnology Consulting Ltd")
    a = grant(conn, "G1", "Shared Number Holdings Inc.", bn=IBM_BN)
    b = grant(conn, "G2", "Shared Number Holdings (West) Inc.", bn=IBM_BN)
    seed_file(("coradixtechnology consulting", "coradix technology consulting", "a space left out"),
              ("shared number holdings west", "", "a different business that typed the same number"),
              ("no such name", "coradix technology consulting", "names nothing"))
    result = run(conn, tmp_path)
    assert result["merged_seed"] == 1 and result["merged_business_number"] == 0
    assert aliases(conn) == {typo: (coradix, "seed")}
    assert records_of(conn, coradix) == 3 and records_of(conn, a) == 1 and records_of(conn, b) == 1
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert "seed\t" in review and "a space left out" in review
    assert "no such name\tcoradix technology consulting\tfrom_norm names no organization" in review


def test_the_committed_seed_file_has_a_header_and_rows_that_read(tmp_path):
    rows, apart, bad = merges.read_seed()
    text = merges.SEED_PATH.read_text(encoding="utf-8")
    header = [line for line in text.splitlines() if not line.startswith("#")][0]
    assert header == ",".join(merges.SEED_COLUMNS) == "from_norm,to_norm,reason,note"
    assert rows == [merges.SeedRow("coradixtechnology consulting", "coradix technology consulting",
                                   "the same name with the space between Coradix and Technology left out", "spelling")]
    assert apart == set() and bad == []
    assert all(norm_name(r.from_norm) == r.from_norm and norm_name(r.to_norm) == r.to_norm for r in rows)
    assert all(r.note in merges.SEED_NOTES for r in rows)
    # The notes the file's comment lists are the ones the reader accepts.
    assert all(note in text for note in merges.SEED_NOTES)


def test_the_seed_reads_comments_and_notes_and_lists_a_row_with_an_unknown_note(tmp_path):
    path = tmp_path / "seed.csv"
    path.write_text("# a comment line\nfrom_norm,to_norm,reason,note\n"
                    "# rows below\n"
                    "Glimmer Post Ltd.,glimmerpost,the space,spelling\n"
                    "old harbour freight,new harbour freight,renamed in 2024,former\n"
                    "quillfeather west,quillfeather,,branch\n"
                    "kept apart co,,two different firms,\n"
                    "odd note,glimmerpost,why,nickname\n", encoding="utf-8")
    rows, apart, bad = merges.read_seed(path)
    assert [(r.from_norm, r.to_norm, r.note) for r in rows] == [
        ("glimmer post", "glimmerpost", "spelling"), ("old harbour freight", "new harbour freight", "former"),
        ("quillfeather west", "quillfeather", "branch")]
    assert apart == {"kept apart"}  # normalized: "co" is a legal form
    assert bad == ["odd note\tglimmerpost\tthe note 'nickname' is not one of spelling, former, short, branch"]
    # A file written before the note column still reads, every note blank.
    old = tmp_path / "old.csv"
    old.write_text("from_norm,to_norm,reason\nnorth harbour,south harbour,why\n", encoding="utf-8")
    assert merges.read_seed(old) == ([merges.SeedRow("north harbour", "south harbour", "why", "")], set(), [])


def test_the_survivor_does_not_flip_and_the_alias_row_is_the_only_memory(conn, tmp_path, seed_file):
    big = grant(conn, "G1", "Northwind Foods Ltd.", bn=IBM_BN)
    grant(conn, "G2", "Northwind Foods Ltd.", bn=IBM_BN)
    small = grant(conn, "G3", "Northwind Foods Limited Partnership Canada", bn=IBM_BN)
    run(conn, tmp_path, T1)
    assert aliases(conn) == {small: (big, "business_number")}
    # The other spelling now has more records; the survivor stays, night after night.
    for i in range(4):
        grant(conn, f"G{10 + i}", "Northwind Foods Limited Partnership Canada", bn=IBM_BN)
    first = conn.execute("SELECT updated_at FROM organizations WHERE id = ?", (big,)).fetchone()[0]
    run(conn, tmp_path, T2)
    assert aliases(conn) == {small: (big, "business_number")} and records_of(conn, big) == 7
    run(conn, tmp_path, T3)
    assert aliases(conn) == {small: (big, "business_number")}
    assert conn.execute("SELECT updated_at FROM organizations WHERE id = ?", (big,)).fetchone()[0] != first
    unchanged = organizations.run(conn, now=T4, review_dir=tmp_path / "review")
    assert unchanged["updated"] == 0
    # Without its alias row the group is decided afresh: the one with most records now.
    conn.execute("DELETE FROM organization_aliases")
    run(conn, tmp_path, T4)
    assert aliases(conn) == {big: (small, "business_number")} and records_of(conn, small) == 7


def test_a_merge_whose_evidence_is_gone_is_undone_on_the_next_run(conn, tmp_path, seed_file, shadow):
    coradix = contract(conn, "C1", "CORADIX TECHNOLOGY CONSULTING LTD.")
    typo = contract(conn, "C2", "CoradixTechnology Consulting Ltd")
    seed_file(("coradixtechnology consulting", "coradix technology consulting", "a space left out"))
    run(conn, tmp_path, T1)
    assert records_of(conn, typo) == 0 and typo in aliases(conn)
    seed_file()
    result = run(conn, tmp_path, T2)
    assert result["merged"] == 0 and aliases(conn) == {}
    assert records_of(conn, typo) == 1 and records_of(conn, coradix) == 1
    row = conn.execute("SELECT display_name, n_contracts FROM organizations WHERE id = ?", (typo,)).fetchone()
    assert tuple(row) == ("CoradixTechnology Consulting Ltd", 1)
    # No merge is listed any more; the spelling rule, in shadow, lists the pair as one it would merge.
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert "seed\t" not in review and f"\tjoins\t{typo}\t" in review


def test_a_merged_id_is_exported_as_an_alias_the_site_redirects_by(conn, tmp_path, seed_file):
    ltd = grant(conn, "G1", "IBM CANADA LTD.", bn=IBM_BN)
    grant(conn, "G2", "IBM CANADA LTD.", bn=IBM_BN)
    bilingual = grant(conn, "G3", "IBM CANADA LIMITED/IBM CANADA LIMITÉE", bn=IBM_BN)
    run(conn, tmp_path)
    assert export_static.resolve_aliases(conn) == {bilingual: ltd}
    out = tmp_path / "static"
    assert export_static.write_aliases(conn, out) == {"alias_shards": 1}
    shard = json.loads((out / "aliases" / f"{bilingual[4:6]}.json").read_text(encoding="utf-8"))
    assert shard == {bilingual: ltd}


def test_the_survivors_profile_names_the_profiles_merged_into_it_with_their_notes(conn, tmp_path, monkeypatch):
    """"Also appears as": the survivor's profile carries each retired profile's name (its most common
    spelling, read from the records that moved), the seed's note and the rule, names with a note first; the
    redirect shards keep their plain ids."""
    path = tmp_path / "organization_aliases.csv"
    monkeypatch.setattr(merges, "SEED_PATH", path)
    new = contract(conn, "R1", "Tidewater Logistics Inc.")
    contract(conn, "R2", "Tidewater Logistics Inc.")
    old = contract(conn, "R3", "Harbourline Freight Inc.")
    contract(conn, "R4", "Harbourline Freight Inc.")
    assert contract(conn, "R5", "HARBOURLINE FREIGHT INC") == old
    path.write_text("from_norm,to_norm,reason,note\nharbourline freight,tidewater logistics,renamed in 2024,former\n",
                    encoding="utf-8")
    ltd = grant(conn, "G1", "IBM CANADA LTD.", bn=IBM_BN)
    grant(conn, "G2", "IBM CANADA LTD.", bn=IBM_BN)
    bilingual = grant(conn, "G3", "IBM CANADA LIMITED/IBM CANADA LIMITÉE", bn=IBM_BN)
    alone = contract(conn, "Q1", "Quillfeather Holdings Inc.")
    run(conn, tmp_path)
    out = tmp_path / "static"
    export_static.export_static(conn, out, csv_dir=tmp_path / "no-csv")

    def profile(oid):
        return json.loads((out / "profiles" / f"{export_static.shard_key(oid)}.json").read_text(encoding="utf-8"))[oid]

    assert profile(new)["aliases"] == [{"id": old, "name": "Harbourline Freight Inc.", "note": "former", "reason": "seed"}]
    # A rule's merge has no note; the name is the spelling its own profile showed.
    assert profile(ltd)["aliases"] == [
        {"id": bilingual, "name": "IBM CANADA LIMITED/IBM CANADA LIMITÉE", "note": None, "reason": "business_number"}]
    assert "aliases" not in profile(alone) and "aliases_total_rows" not in profile(new)
    for retired, live in ((old, new), (bilingual, ltd)):
        shard = json.loads((out / "aliases" / f"{retired[4:6]}.json").read_text(encoding="utf-8"))
        assert shard[retired] == live
    # Past the cap the count says how many: the name with a note first, then by records.
    third = contract(conn, "R6", "Tidewater Logistik Inc.")
    path.write_text("from_norm,to_norm,reason,note\nharbourline freight,tidewater logistics,renamed in 2024,former\n"
                    "tidewater logistik,tidewater logistics,typo,\n", encoding="utf-8")
    run(conn, tmp_path, T2)
    model = export_static.Model(conn, date(2026, 11, 2))
    try:
        assert [a["id"] for a in export_static.profile_aliases(conn, model)[new][0]] == [old, third]
        monkeypatch.setattr(export_static, "PROFILE_ALIASES", 1)
        listed, total = export_static.profile_aliases(conn, model)[new]
    finally:
        export_static.drop_temp(conn)
    assert [a["id"] for a in listed] == [old] and total == 2


def test_names_that_are_not_organizations_keep_their_records_and_no_organization(conn, tmp_path, seed_file):
    assert organizations.upsert(conn, "GENERIC PSPC-MANAGE SUPPLIER ACCOUNT", source="awards") is None
    assert organizations.upsert(conn, "[REDACTED]", source="contracts") is None
    assert organizations.is_not_organization("generic supplier account so sa master agreement")
    assert not organizations.is_not_organization("generic pharmaceuticals canada")
    # A record loaded before the seed listed the name still points at an organization: the stage clears it.
    generic = org_id(norm_name("GENERIC PSPC-MANAGE SUPPLIER ACCOUNT"))
    conn.execute("INSERT INTO organizations (id, display_name, norm_name, updated_at) VALUES (?, ?, ?, ?)",
                 (generic, "GENERIC PSPC-MANAGE SUPPLIER ACCOUNT", "generic pspc manage supplier account", T1))
    conn.execute("INSERT INTO awards (reference, amendment, supplier_raw, organization_id, amount, total_value, currency, "
                 "status, source_file, first_seen, last_seen) VALUES ('GEN-1', 0, 'GENERIC PSPC-MANAGE SUPPLIER ACCOUNT', "
                 "?, 5000000, 5000000, 'CAD', 'active', 'f', '2026-10-31', '2026-10-31')", (generic,))
    kept = award(conn, "A1", "Real Supplier Inc.")
    result = run(conn, tmp_path)
    assert result["not_organizations"] == 1
    row = conn.execute("SELECT supplier_raw, organization_id, supplier_withheld FROM awards WHERE reference = 'GEN-1'").fetchone()
    assert tuple(row) == ("GENERIC PSPC-MANAGE SUPPLIER ACCOUNT", None, 0)
    assert {r[0] for r in conn.execute("SELECT id FROM organizations")} == {kept}


# -- the spelling rule (shadow by default) and the candidates for the seed ---------------------------------
#
# Invented firm names in the shapes the 2026-11-01 samples showed; the public institutions and the two Bell
# companies are the analysis's own rejected pairs.

SPELLING_HEADER = "# key\tsteps\tplace\tprovinces_overlap\trole\tid\tname\trecords\tprovinces\tregistry"
CANDIDATE_HEADER = ("# kind\tplace\tfrom_id\tfrom_name\tfrom_records\tto_id\tto_name\tto_records\tdetail\tseed_row"
                    "\tregistry")


def award_at(conn, ref, name, *, city, postal, province, amendment=0):
    oid = organizations.upsert(conn, name, source="awards", country="CA", province=province, city=city,
                               postal_code=postal)
    conn.execute("INSERT INTO awards (reference, amendment, supplier_raw, supplier_country, supplier_province, "
                 "supplier_city, supplier_postal, organization_id, amount, total_value, currency, status, awarded, "
                 "source_file, first_seen, last_seen) VALUES (?, ?, ?, 'CA', ?, ?, ?, ?, 1000, 1000, 'CAD', 'active', "
                 "'2025-01-01', 'f', '2026-10-31', '2026-10-31')",
                 (ref, amendment, name, province, city, postal, oid))
    return oid


def section(review, header):
    """The data lines of the review file's section under a column header line."""
    lines = review.splitlines()
    out = []
    for line in lines[lines.index(header) + 1:]:
        if line.startswith("#"):
            break
        out.append(line.split("\t"))
    return out


@pytest.fixture
def spelling_world(conn):
    """Three groups the spelling rule forms, and the pairs its guards must refuse."""
    ids = {
        "quill_short": award_at(conn, "Q1", "Quillfeather Cnslt.Ltd.", city="Ottawa", postal="K1A 0B1", province="ON"),
        "quill": award_at(conn, "Q2", "Quillfeather Consulting Ltd.", city="Ottawa", postal="K1A 0B1", province="ON"),
        "glimmer": contract(conn, "G1", "GLIMMERPOST LTD"),
        "glimmer_spaced": award_at(conn, "G2", "GLIMMER POST LTD.", city="Montréal", postal="H2X 1Y4", province="QC"),
        "bright_code": contract(conn, "B1", "Brightmoor LLP, T4348"),
        "bright": contract(conn, "B2", "Brightmoor LLP"),
    }
    award_at(conn, "Q3", "Quillfeather Consulting Ltd.", city="Ottawa", postal="K1A 0B1", province="ON")
    contract(conn, "B3", "Brightmoor LLP")
    # Refused: Quebec farms one letter apart, universities with place words, Bell Canada and Bell Textron.
    for ref, name in (("F1", "Ferme Valco inc."), ("F2", "Ferme Valdo inc."), ("U1", "University of Toronto"),
                      ("U2", "University of Ottawa"), ("L1", "Bell Canada"), ("L2", "Bell Textron Canada Limited")):
        ids[name] = contract(conn, ref, name)
    return ids


def test_the_spelling_rule_in_shadow_lists_its_groups_and_merges_nothing(conn, tmp_path, seed_file, spelling_world,
                                                                          shadow):
    ids = spelling_world
    before = {oid: records_of(conn, oid) for oid in ids.values()}
    result = run(conn, tmp_path)
    assert (result["merged"], result["merged_spelling"], result["spelling_groups"]) == (0, 0, 3)
    assert aliases(conn) == {} and {oid: records_of(conn, oid) for oid in ids.values()} == before
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert '# Spelling rule (shadow, nothing merged until config.ORG_SPELLING_MERGE is "on"): 3 groups' in review
    rows = section(review, SPELLING_HEADER)
    assert all(len(r) == 10 for r in rows) and len(rows) == 6
    # The group whose members were never seen in one province comes first; each group's survivor leads it.
    assert [(r[0], r[1], r[2], r[3], r[4]) for r in rows[:2]] == [
        ("glimmerpost", "spacing", "", "no", "survivor"), ("glimmerpost", "spacing", "", "no", "joins")]
    assert {rows[0][5], rows[1][5]} == {ids["glimmer"], ids["glimmer_spaced"]}
    by_key = {}
    for r in rows:
        by_key.setdefault(r[0], []).append(r)
    assert by_key["quillfeatherconsulting"] == [
        ["quillfeatherconsulting", "abbreviation", "city, postal", "yes", "survivor", ids["quill"],
         "Quillfeather Consulting Ltd.", "2", "ON", ""],
        ["quillfeatherconsulting", "abbreviation", "city, postal", "yes", "joins", ids["quill_short"],
         "Quillfeather Cnslt.Ltd.", "1", "ON", "unknown"]]
    assert [(r[1], r[2], r[4], r[5]) for r in by_key["brightmoor"]] == [
        ("vendor code", "", "survivor", ids["bright"]), ("vendor code", "", "joins", ids["bright_code"])]
    for name in ("Ferme Valco", "Ferme Valdo", "University of", "Bell "):
        assert not any(name in r[6] for r in rows), name
    log = conn.execute("SELECT detail, notice FROM sources_log WHERE source = 'organizations'").fetchone()
    assert "spelling_groups=3" in log["detail"] and "spelling rule shadow: 3 groups (3 organizations" in log["notice"]


def test_the_spelling_rule_on_merges_its_groups_and_off_leaves_them(conn, tmp_path, seed_file, spelling_world,
                                                                     monkeypatch):
    ids = spelling_world
    monkeypatch.setattr(merges.config, "ORG_SPELLING_MERGE", "off")
    result = run(conn, tmp_path, T1)
    assert (result["merged"], result["spelling_groups"]) == (0, 0)
    monkeypatch.setattr(merges.config, "ORG_SPELLING_MERGE", "on")
    result = run(conn, tmp_path, T2)
    assert (result["merged_spelling"], result["spelling_groups"]) == (3, 3)
    merged = aliases(conn)
    assert merged[ids["quill_short"]] == (ids["quill"], "spelling")
    assert merged[ids["bright_code"]] == (ids["bright"], "spelling")
    assert len(merged) == 3 and {ids["glimmer"], ids["glimmer_spaced"]} & set(merged)
    assert records_of(conn, ids["quill"]) == 3 and records_of(conn, ids["bright"]) == 3
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert f"spelling\t{ids['quill_short']}\tQuillfeather Cnslt.Ltd.\t1\t{ids['quill']}\t" in review
    assert "quillfeatherconsulting (abbreviation)" in review and "# Spelling rule (merged" in review
    # The next night keeps the same survivors; a typo in the flag stops the stage before anything moves.
    run(conn, tmp_path, T3)
    assert aliases(conn) == merged
    monkeypatch.setattr(merges.config, "ORG_SPELLING_MERGE", "yes")
    with pytest.raises(ValueError, match="ORG_SPELLING_MERGE"):
        run(conn, tmp_path, T4)
    assert aliases(conn) == merged


def test_a_person_named_spelling_or_a_keep_apart_row_gives_no_key(conn, tmp_path, seed_file, shadow):
    firm = contract(conn, "P1", "Laura Quentaro Inc.")
    branch = contract(conn, "P2", "LAURA QUENTARO INC. (WEST)")
    run(conn, tmp_path, T1)
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert {r[5] for r in section(review, SPELLING_HEADER)} == {firm, branch}
    # A spelling stored before the person test read it so ("Laura Quentaro", the same normalized name): the
    # organization gets no key, and the other spelling has no one to join.
    conn.execute("INSERT INTO contracts (owner_org, reference, vendor_raw, vendor_country, value, contract_date, "
                 "organization_id, loaded_at) VALUES ('dept-x', 'P3', 'Laura Quentaro', 'CA', 1000, '2025-06-01', ?, ?)",
                 (firm, T1))
    assert run(conn, tmp_path, T2)["spelling_groups"] == 0
    conn.execute("DELETE FROM contracts WHERE reference = 'P3'")
    seed_file(("laura quentaro inc west", "", "a different firm"))
    assert run(conn, tmp_path, T3)["spelling_groups"] == 0


def test_the_candidates_for_the_seed_are_listed_by_kind_with_the_row_that_would_merge_them(conn, tmp_path, seed_file):
    typo = contract(conn, "T1", "Keplerline Communicatons Ltd")
    right = contract(conn, "T2", "Keplerline Communications Ltd.")
    contract(conn, "T3", "Keplerline Communications Ltd.")
    numbered = contract(conn, "O1", "1019837 ONTARIO INC O/A DYNAMIC TEMPS CONSULTANTS")
    contract(conn, "O2", "1019837 ONTARIO INC O/A DYNAMIC TEMPS CONSULTANTS")
    trade = contract(conn, "O3", "DYNAMIC TEMPS CONSULTANTS")
    branch = contract(conn, "C1", "Cofremo Ottawa")
    head = award_at(conn, "C2", "COFREMO INC.", city="Ottawa", postal="K1A 0B1", province="ON")
    short = contract(conn, "S1", "Simtex")
    full = award_at(conn, "S2", "Simtex Defence Inc.", city="Halifax", postal="B3H 4R2", province="NS")
    old = award_at(conn, "R1", "Harbourline Freight Inc.", city="Halifax", postal="B3H 4R2", province="NS")
    new = award_at(conn, "R1", "Tidewater Logistics Inc.", city="Halifax", postal="B3H 4R2", province="NS",
                   amendment=1)
    for ref, name in (("F1", "Ferme Valco inc."), ("F2", "Ferme Valdo inc."), ("L1", "Bell Canada"),
                      ("L2", "Bell Textron Canada Limited")):
        contract(conn, ref, name)
    result = run(conn, tmp_path, T1)
    assert result["merged"] == 0 and result["seed_candidates"] == 5
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    rows = section(review, CANDIDATE_HEADER)
    assert all(len(r) == 11 for r in rows) and {r[10] for r in rows} == {"unknown"}
    got = {(r[0], r[2], r[5]): (r[1], r[9]) for r in rows}
    assert got == {
        ("operating", trade, numbered): ("", "dynamic temps consultants,1019837 ontario,,"),
        ("former", old, new): ("city, postal", "harbourline freight,tidewater logistics,,former"),
        ("place", branch, head): ("", "cofremo ottawa,cofremo,,branch"),
        ("short", short, full): ("", "simtex,simtex defence,,short"),
        ("typo", typo, right): ("", "keplerline communicatons,keplerline communications,,spelling"),
    }
    assert [r[0] for r in rows] == list(merges.CANDIDATE_KINDS)  # listed kind by kind
    # The farms one letter apart (short words) and Bell Canada with Bell Textron are no candidates.
    assert not any("Ferme" in r[3] or "Bell" in r[3] for r in rows)
    # A row accepted into the seed merges the pair, and a keep-apart row drops it from the list.
    seed_file(("keplerline communicatons", "keplerline communications", "a letter left out"),
              ("simtex", "", "another firm"))
    result = run(conn, tmp_path, T2)
    assert result["merged_seed"] == 1 and aliases(conn) == {typo: (right, "seed")}
    kinds = [r[0] for r in section((tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8"),
                                   CANDIDATE_HEADER)]
    assert kinds == ["operating", "former", "place"]


# -- the operator's identity rulings of 2026-11-07 ------------------------------------------------------


def test_the_spelling_rule_is_on_and_the_review_file_still_lists_every_group(conn, tmp_path, seed_file, spelling_world):
    """Ruling 1: the spelling rule merges by default, and the file keeps each group (the shadow section's
    columns) as the record of what merged, beside the merges list and the run log's counts."""
    ids = spelling_world
    assert merges.config.ORG_SPELLING_MERGE == "on"
    result = run(conn, tmp_path)
    assert (result["merged_spelling"], result["spelling_groups"]) == (3, 3)
    review = (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")
    assert "# Spelling rule (merged (each merge is also listed above)): 3 groups sharing a match key" in review
    rows = section(review, SPELLING_HEADER)
    assert len(rows) == 6 and {r[5] for r in rows} == {ids[k] for k in ("quill_short", "quill", "glimmer",
                                                                         "glimmer_spaced", "bright_code", "bright")}
    joined = {r[5]: r for r in rows if r[4] == "joins"}
    assert all(aliases(conn)[oid][1] == "spelling" for oid in joined)
    log = conn.execute("SELECT detail, notice FROM sources_log WHERE source = 'organizations'").fetchone()
    assert "merged_spelling=3" in log["detail"] and "spelling rule on: 3 groups (3 organizations" in log["notice"]
    summary = json.loads((tmp_path / "review" / merges.SUMMARY_FILE).read_text(encoding="utf-8"))
    assert (summary["spelling_mode"], summary["spelling_groups"], summary["spelling_joined"]) == ("on", 3, 3)


def test_legal_forms_of_one_name_stay_one_organization(conn, tmp_path, seed_file):
    """Ruling 2: different legal forms of one name share a profile ("Deloitte Inc." and "Deloitte LLP"). The
    id is made from the name without its legal form, so no merge is needed and none is made."""
    assert org_id(norm_name("Deloitte Inc.")) == org_id(norm_name("Deloitte LLP"))
    forms = ("Quarrystone Inc.", "QUARRYSTONE LLP", "Quarrystone Ltd", "Quarrystone S.E.N.C.R.L.", "Quarrystone Ltée")
    oids = {contract(conn, f"Q{i}", name) for i, name in enumerate(forms)}
    assert len(oids) == 1
    result = run(conn, tmp_path)
    [oid] = oids
    assert result["merged"] == 0 and aliases(conn) == {}
    assert records_of(conn, oid) == len(forms)
    names = {r[0] for r in conn.execute("SELECT raw_name FROM organization_names WHERE organization_id = ?", (oid,))}
    assert names == set(forms)


def test_a_seed_merge_keeps_its_note_on_the_alias_row_and_the_download(conn, tmp_path, monkeypatch):
    """The seed's note travels with the merge to organization_aliases and the alias download; a changed note
    rewrites the note and leaves the date the merge holds since."""
    from awardwatch_pipeline import export

    path = tmp_path / "organization_aliases.csv"
    monkeypatch.setattr(merges, "SEED_PATH", path)
    old = contract(conn, "R1", "Harbourline Freight Inc.")
    new = contract(conn, "R2", "Tidewater Logistics Inc.")
    contract(conn, "R3", "Tidewater Logistics Inc.")
    path.write_text("from_norm,to_norm,reason,note\nharbourline freight,tidewater logistics,renamed in 2024,former\n",
                    encoding="utf-8")
    run(conn, tmp_path, T1)
    assert tuple(conn.execute("SELECT new_id, reason, note, created_at FROM organization_aliases WHERE old_id = ?",
                              (old,)).fetchone()) == (new, "seed", "former", T1)
    path.write_text("from_norm,to_norm,reason,note\nharbourline freight,tidewater logistics,the same name,spelling\n",
                    encoding="utf-8")
    run(conn, tmp_path, T2)
    assert tuple(conn.execute("SELECT note, created_at FROM organization_aliases WHERE old_id = ?",
                              (old,)).fetchone()) == ("spelling", T1)
    out = tmp_path / "csv"
    out.mkdir()
    assert export.write_alias_map(conn, out / export.ALIASES_FILE) == 1
    text = (out / export.ALIASES_FILE).read_text(encoding="utf-8-sig")
    assert text == f"from_id,to_id,reason,note,since\n{old},{new},seed,spelling,{T1[:10]}\n"
