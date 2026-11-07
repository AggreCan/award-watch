"""registry_review.py: the registry check of the organization review, a back end for the operator only.

Each pair the review file lists is marked from the local registry tables and, bounded, OrgBook BC's public
search: the same registry record, different records, or unknown. Nothing reaches the export. Invented names.
"""

import json
from urllib.parse import urlencode

from conftest import FakeResponse
from awardwatch_pipeline import config, export_static, merges, organizations, registry_review
from test_merges import CANDIDATE_HEADER, SPELLING_HEADER, award_at, contract, section, seed_file  # noqa: F401

T1, T2 = "2026-11-16T12:40:00Z", "2026-11-17T12:40:00Z"


def orgbook_url(name):
    return f"{config.ORGBOOK_SEARCH}?{urlencode({'q': name, 'inactive': 'any'})}"


def answer(*registrations):
    """An OrgBook search answer: (source_id, name) per registration."""
    return json.dumps({"total": len(registrations), "results": [
        {"id": i, "source_id": sid, "type": "registration", "names": [{"text": text}], "inactive": False}
        for i, (sid, text) in enumerate(registrations)]}).encode()


def federal(conn, number, legal, norm):
    conn.execute("INSERT INTO federal_corporations (number, legal_name, norm_name, status, source_url) "
                 "VALUES (?, ?, ?, 'Active', 'https://example.invalid/corporations.csv')", (number, legal, norm))


def world(conn):
    """A spelling group in British Columbia, one in Ontario, and a typo pair the federal extract tells apart."""
    ids = {
        "glimmer": contract(conn, "G1", "GLIMMERPOST LTD"),
        "glimmer_spaced": award_at(conn, "G2", "GLIMMER POST LTD.", city="Victoria", postal="V8W 1A1", province="BC"),
        "quill_short": award_at(conn, "Q1", "Quillfeather Cnslt.Ltd.", city="Ottawa", postal="K1A 0B1", province="ON"),
        "quill": award_at(conn, "Q2", "Quillfeather Consulting Ltd.", city="Ottawa", postal="K1A 0B1", province="ON"),
        "typo": contract(conn, "T1", "Keplerline Communicatons Ltd"),
        "right": contract(conn, "T2", "Keplerline Communications Ltd."),
    }
    award_at(conn, "Q3", "Quillfeather Consulting Ltd.", city="Ottawa", postal="K1A 0B1", province="ON")
    contract(conn, "T3", "Keplerline Communications Ltd.")
    federal(conn, "2222222", "KEPLERLINE COMMUNICATONS LTD.", "keplerline communicatons")
    federal(conn, "3333333", "KEPLERLINE COMMUNICATIONS LTD.", "keplerline communications")
    return ids


def client_for(fake_client, mapping):
    client = fake_client(mapping)
    timeouts = []
    plain = client.fake_session.get

    def get(url, headers=None, timeout=None, stream=False):
        timeouts.append(timeout)
        return plain(url, headers=headers, timeout=timeout, stream=stream)

    client.fake_session.get = get
    client.timeouts = timeouts
    return client


def run(conn, tmp_path, client, now=T1):
    return organizations.run(conn, now=now, review_dir=tmp_path / "review",
                             orgbook=registry_review.orgbook_client(client))


def review_of(tmp_path):
    return (tmp_path / "review" / merges.REVIEW_FILE).read_text(encoding="utf-8")


ORGBOOK = {
    orgbook_url("GLIMMERPOST LTD"): answer(("BC0700001", "Glimmerpost Ltd.")),
    orgbook_url("GLIMMER POST LTD."): answer(("BC0700001", "Glimmerpost Ltd."), ("BC0999999", "Glimmer Stone Ltd.")),
    orgbook_url("Quillfeather Cnslt.Ltd."): answer(("A0012345", "QUILLFEATHER CONSULTING LTD.")),
    orgbook_url("Quillfeather Consulting Ltd."): answer(("A0012345", "QUILLFEATHER CONSULTING LTD.")),
}


def test_each_pair_is_marked_from_the_local_tables_and_orgbook(conn, tmp_path, seed_file, fake_client):
    ids = world(conn)
    client = client_for(fake_client, ORGBOOK)
    result = run(conn, tmp_path, client)
    assert result["merged_spelling"] == 2
    review = review_of(tmp_path)
    groups = {r[5]: r for r in section(review, SPELLING_HEADER)}
    # Both spellings lead to one BC registration (the second search also lists another firm, whose name matches
    # neither): the merge is confirmed.
    assert groups[ids["glimmer"]][4] == "joins"
    assert groups[ids["glimmer"]][9] == "same registry record (bc_orgbook BC0700001 = BC0700001)"
    assert groups[ids["glimmer_spaced"]][9] == ""  # the survivor carries no verdict of its own
    assert groups[ids["quill_short"]][9] == "same registry record (bc_orgbook A0012345 = A0012345)"
    # The typo pair: two federal corporations, one per name, so two records; decided locally, nothing searched.
    [typo] = [r for r in section(review, CANDIDATE_HEADER) if r[0] == "typo"]
    assert (typo[2], typo[5]) == (ids["typo"], ids["right"])
    assert typo[10] == "different records (corporations_canada 2222222 / 3333333)"
    searched = [url for url, _ in client.fake_session.calls]
    assert sorted(searched) == sorted(ORGBOOK)
    # Asked of OrgBook alone, under the pipeline's user agent, one request at a time, 10 seconds to answer.
    assert all(url.startswith(config.ORGBOOK_SEARCH + "?") for url in searched)
    assert all(h["User-Agent"] == config.USER_AGENT for _, h in client.fake_session.calls)
    assert config.ORGBOOK_TIMEOUT_S == 10 and set(client.timeouts) == {(10.0, 10.0)}
    # The headline counts beside the file, for the semi-monthly review.
    summary = json.loads((tmp_path / "review" / merges.SUMMARY_FILE).read_text(encoding="utf-8"))
    assert summary["registry"] == {"pairs": 3, "same": 2, "different": 1, "unknown": 0, "different_merged": 0,
                                   "orgbook_searched": 4, "orgbook_failed": 0}
    assert (summary["spelling_mode"], summary["spelling_groups"], summary["spelling_joined"]) == ("on", 2, 2)
    assert summary["candidates"]["typo"] == 1 and summary["listed"] is True


def test_nothing_from_the_check_reaches_the_export(conn, tmp_path, seed_file, fake_client):
    world(conn)
    run(conn, tmp_path, client_for(fake_client, ORGBOOK))
    # OrgBook's answers are in their own cache table, which no export reads; registry_matches, which profiles
    # export, holds none of them.
    assert conn.execute("SELECT COUNT(*) FROM orgbook_lookups").fetchone()[0] == 4
    assert conn.execute("SELECT COUNT(*) FROM registry_matches WHERE registry = 'bc_orgbook'").fetchone()[0] == 0
    out = tmp_path / "static"
    export_static.export_static(conn, out, csv_dir=tmp_path / "no-csv")
    text = "".join(p.read_text(encoding="utf-8") for p in out.rglob("*.json"))
    for word in ("BC0700001", "A0012345", "bc_orgbook", "same registry record", "orgbook"):
        assert word not in text, word


def test_the_searches_are_bounded_cached_and_stop_at_the_first_failure(conn, tmp_path, seed_file, fake_client,
                                                                        monkeypatch):
    ids = world(conn)
    # Two searches tonight: the pair with a member in British Columbia goes first.
    monkeypatch.setattr(config, "ORGBOOK_BUDGET", 2)
    client = client_for(fake_client, ORGBOOK)
    run(conn, tmp_path, client)
    assert sorted(url for url, _ in client.fake_session.calls) == sorted(
        [orgbook_url("GLIMMERPOST LTD"), orgbook_url("GLIMMER POST LTD.")])
    groups = {r[5]: r for r in section(review_of(tmp_path), SPELLING_HEADER)}
    assert groups[ids["glimmer"]][9].startswith("same registry record")
    assert groups[ids["quill_short"]][9] == "unknown"
    # The next night the cache answers for the first two and the budget goes to the others.
    run(conn, tmp_path, client, now=T2)
    assert len(client.fake_session.calls) == 4
    groups = {r[5]: r for r in section(review_of(tmp_path), SPELLING_HEADER)}
    assert groups[ids["quill_short"]][9].startswith("same registry record")
    # Within ORGBOOK_RECHECK_DAYS nothing is asked again.
    run(conn, tmp_path, client, now="2026-12-01T12:40:00Z")
    assert len(client.fake_session.calls) == 4
    # Past it, the names are searched again; a host that answers 503 ends the night's searches at once (one
    # attempt, no retry), and the pairs keep what the cache says.
    monkeypatch.setattr(config, "ORGBOOK_BUDGET", 200)
    failing = client_for(fake_client, {url: FakeResponse(503) for url in ORGBOOK})
    run(conn, tmp_path, failing, now="2027-07-01T12:40:00Z")
    assert len(failing.fake_session.calls) == 1
    summary = json.loads((tmp_path / "review" / merges.SUMMARY_FILE).read_text(encoding="utf-8"))
    assert (summary["registry"]["orgbook_searched"], summary["registry"]["orgbook_failed"]) == (1, 1)
    assert summary["registry"]["same"] == 2
    log = conn.execute("SELECT ok FROM sources_log WHERE source = 'organizations' ORDER BY id DESC").fetchone()
    assert log["ok"] == 1


def test_a_samples_run_asks_nothing_and_a_name_several_registrations_carry_decides_nothing(conn, tmp_path,
                                                                                         seed_file):
    ids = world(conn)
    federal(conn, "4444444", "KEPLERLINE COMMUNICATONS (2019) LTD.", "keplerline communicatons")
    assert registry_review.orgbook_client(None) is None
    run(conn, tmp_path, None)
    review = review_of(tmp_path)
    [typo] = [r for r in section(review, CANDIDATE_HEADER) if r[0] == "typo"]
    assert typo[10] == "unknown"
    groups = {r[5]: r for r in section(review, SPELLING_HEADER)}
    assert groups[ids["glimmer"]][9] == "unknown"
    assert conn.execute("SELECT COUNT(*) FROM orgbook_lookups").fetchone()[0] == 0


def test_the_verdict_rules():
    v = registry_review.verdict
    assert v({"corporations_canada": {"1"}}, {"corporations_canada": {"1"}})[0] == registry_review.SAME
    assert v({"corporations_canada": {"1"}}, {"corporations_canada": {"2"}})[0] == registry_review.DIFFERENT
    assert v({"corporations_canada": {"1", "2"}}, {"corporations_canada": {"1"}})[0] == registry_review.UNKNOWN
    assert v({"corporations_canada": {"1"}}, {"bc_orgbook": {"A1"}})[0] == registry_review.UNKNOWN
    # Registries that disagree decide nothing.
    assert v({"corporations_canada": {"1"}, "bc_orgbook": {"A1"}},
             {"corporations_canada": {"2"}, "bc_orgbook": {"A1"}})[0] == registry_review.UNKNOWN
    # OrgBook: a registration matches by its normalized name or the spelling's match key; two that match are
    # no answer.
    assert registry_review.orgbook_match([{"source_id": "A1", "names": [{"text": "QUILLFEATHER CONSULTING LTD."}]}],
                                         "quillfeather cnslt", "Quillfeather Cnslt.Ltd.") == \
        ("A1", "QUILLFEATHER CONSULTING LTD.", 1)
    two = [{"source_id": "A1", "names": [{"text": "Glimmerpost Ltd."}]},
           {"source_id": "A2", "names": [{"text": "GLIMMERPOST LIMITED"}]}]
    assert registry_review.orgbook_match(two, "glimmerpost", "GLIMMERPOST LTD") == (None, None, 2)
    assert registry_review.orgbook_match([], "glimmerpost", "GLIMMERPOST LTD") == (None, None, 0)


def test_the_quebec_register_is_never_read():
    import inspect

    source = inspect.getsource(registry_review)
    # Named only to say why it is not read (its licence's non-commercial clause).
    assert "import registry_quebec" not in source and "from .sources import registry_quebec" not in source
    assert "CC BY-NC-SA" in source
    assert (config.ORGBOOK_BUDGET, registry_review.ORGBOOK_RECHECK_DAYS) == (200, 180)
