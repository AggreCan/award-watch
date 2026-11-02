"""merges.py, run inside the organizations stage: a shared business number, a name cut at 35 characters,
the reviewed seed and its keep-apart rows, survivors that do not flip, merges undone when their evidence
goes, the aliases the site redirects by, and the names that are not organizations."""

import json

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


def test_the_seed_merges_by_hand_and_an_empty_to_norm_keeps_an_organization_apart(conn, tmp_path, seed_file):
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
    rows, apart = merges.read_seed()
    text = merges.SEED_PATH.read_text(encoding="utf-8")
    assert text.splitlines()[0] == "from_norm,to_norm,reason" and "#" not in text
    assert rows == [("coradixtechnology consulting", "coradix technology consulting",
                     "the same name with the space between Coradix and Technology left out")]
    assert apart == set()
    assert all(norm_name(src) == src and norm_name(dst) == dst for src, dst, _ in rows)


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


def test_a_merge_whose_evidence_is_gone_is_undone_on_the_next_run(conn, tmp_path, seed_file):
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
    assert not (tmp_path / "review" / merges.REVIEW_FILE).exists()


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
