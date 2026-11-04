"""The nightly link sample: the addresses, the draw, the checks with the network faked, the record and the command."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import requests

from awardwatch_pipeline import cli, config, link_sample
from awardwatch_pipeline.db import connect, set_meta
from awardwatch_pipeline.link_sample import Link

SITE = Path(__file__).resolve().parents[2] / "site" / "src" / "pages"
DAY = "2026-11-04"
STAMP = "2026-11-04T13:10:00Z"


# -- the addresses --------------------------------------------------------------------


def test_the_addresses_are_the_ones_the_site_links():
    assert link_sample.tender_url("SSC-26-00040563:A:1") == \
        "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/ssc-26-00040563a1"
    assert link_sample.tender_url("01044-221065/001/PI", "fr") == \
        "https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/01044-221065/001/pi"
    assert link_sample.award_url("SSC-26-00035339:T") == \
        "https://canadabuys.canada.ca/en/tender-opportunities/award-notice/ssc-26-00035339t"
    assert link_sample.award_url("cb-1", "fr") == \
        "https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/cb-1"
    # encodeURIComponent's escaping: a slash and a space are escaped, an apostrophe is not.
    assert link_sample.contract_url("C/1 2'") == "https://search.open.canada.ca/contracts/?search_text=C%2F1%202'"
    assert link_sample.grant_url("tbs-sct", "GC 01") == \
        "https://search.open.canada.ca/grants/record/tbs-sct%2CGC%2001%2Ccurrent"
    assert link_sample.lobbying_url("12345") == \
        "https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/cmmLgPblcVw?comlogId=12345"
    assert link_sample.dataset_url(config.GRANTS_DATASET, "fr") == \
        f"https://open.canada.ca/data/fr/dataset/{config.GRANTS_DATASET}"
    assert link_sample.organization_url("tbs-sct") == "https://open.canada.ca/data/en/organization/tbs-sct"
    # Each address's fixed part is written the same way in the site's pages, so a
    # change there that is not made here fails this test.
    pages = "\n".join((SITE / name).read_text(encoding="utf-8") for name in ("shared.tsx", "buyers.tsx", "data.tsx"))
    for fixed in ("https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/",
                  "https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/",
                  "https://canadabuys.canada.ca/en/tender-opportunities/award-notice/",
                  "https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/",
                  "https://search.open.canada.ca/contracts/?search_text=",
                  "https://search.open.canada.ca/grants/record/",
                  ",current",
                  "https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/cmmLgPblcVw?comlogId=",
                  "/dataset/", "/organization/"):
        assert fixed in pages, fixed
    # The dataset ids are the site's.
    for ident in link_sample.DATASETS.values():
        assert ident in pages, ident


# -- the draw -------------------------------------------------------------------------


def fill(conn, n=20, *, lobbying=None):
    """n linked records of each table kind, rows the site does not link, and four buyers."""
    lobbying = n if lobbying is None else lobbying
    conn.execute("INSERT INTO organizations (id, display_name, norm_name, updated_at) VALUES ('o1', 'A Ltd', 'a', ?)",
                 (STAMP,))
    for i in range(n):
        for amendment in (0, 1):  # two versions of each notice: one link
            conn.execute("INSERT INTO tenders (reference, amendment, source_file, first_seen, last_seen) "
                         "VALUES (?, ?, 'x.csv', ?, ?)", (f"cb-{i:03d}-T", amendment, DAY, DAY))
            conn.execute("INSERT INTO awards (reference, amendment, source_file, first_seen, last_seen) "
                         "VALUES (?, ?, 'x.csv', ?, ?)", (f"cb-{i:03d}-A", amendment, DAY, DAY))
        conn.execute("INSERT INTO contracts (owner_org, reference, organization_id, loaded_at) VALUES ('pspc', ?, 'o1', ?)",
                     (f"C-{i:03d}", STAMP))
        conn.execute("INSERT INTO grants (owner_org, reference, amendment, organization_id, loaded_at) "
                     "VALUES ('ised', ?, 0, 'o1', ?)", (f"G-{i:03d}", STAMP))
    for i in range(lobbying):
        conn.execute("INSERT INTO lobbying_communications (comm_number, organization_id, loaded_at) VALUES (?, 'o1', ?)",
                     (f"{500 + i}", STAMP))
    # Rows no profile shows: never drawn.
    for i in range(n):
        conn.execute("INSERT INTO contracts (owner_org, reference, organization_id, loaded_at) VALUES ('dnd', ?, NULL, ?)",
                     (f"X-{i:03d}", STAMP))
        conn.execute("INSERT INTO grants (owner_org, reference, amendment, organization_id, loaded_at) "
                     "VALUES ('dnd', ?, 0, NULL, ?)", (f"Y-{i:03d}", STAMP))
        conn.execute("INSERT INTO lobbying_communications (comm_number, organization_id, loaded_at) VALUES (?, NULL, ?)",
                     (f"{900 + i}", STAMP))
    for ident, ckan, n_awards in (("pspc", "pspc-spac", 3), ("ised", "ised-isde", 1), ("dnd", "dnd-mdn", 2),
                                  ("idle", "idle-org", 0)):
        conn.execute("INSERT INTO buyers (id, name_en, ckan_org, n_awards, updated_at) VALUES (?, ?, ?, ?, ?)",
                     (ident, ident.upper(), ckan, n_awards, STAMP))
    conn.commit()


def test_the_draw_is_stratified_by_kind_and_fixed_by_the_data_date(conn):
    fill(conn)
    links = link_sample.draw(conn, DAY)
    assert len(links) == link_sample.SAMPLE_SIZE == 40
    # Dealt one kind at a time: six kinds share 40 as 7, 7, 7, 7, 6, 6, and the kinds alternate.
    counts = {k: sum(1 for x in links if x.kind == k) for k in link_sample.KINDS}
    assert counts == {"tender": 7, "award": 7, "contract": 7, "grant": 7, "lobbying": 6, "portal": 6}
    assert [x.kind for x in links[:6]] == list(link_sample.KINDS)
    # No record twice, though each notice has two versions.
    assert len({(x.kind, x.ref) for x in links}) == 40
    # Rows without an organization are never drawn, nor a buyer with nothing to show.
    assert not any(x.ref.startswith(("dnd:", "9")) for x in links)
    assert not any("idle-org" in x.url for x in links)
    # The same data date draws the same links in the same order; another date, another sample.
    assert link_sample.draw(conn, DAY) == links
    assert link_sample.draw(conn, "2026-11-05") != links
    # The notices are linked on both hosts, as the site links them in either language.
    hosts = {x.url.split("/")[2] for d in ("2026-11-04", "2026-11-05", "2026-11-06")
             for x in link_sample.draw(conn, d) if x.kind in ("tender", "award")}
    assert hosts == {"canadabuys.canada.ca", "achatscanada.canada.ca"}
    for x in links:
        assert x.url.startswith("https://"), x


def test_a_short_kind_passes_its_share_on_and_leaves_the_others_draws_alone(conn, tmp_path):
    fill(conn, lobbying=2)
    links = link_sample.draw(conn, DAY)
    assert len(links) == 40
    assert sum(1 for x in links if x.kind == "lobbying") == 2
    # Each kind draws with its own seed: the tenders drawn are the first ones of a fuller sample.
    other = connect(tmp_path / "full.sqlite")
    fill(other)
    full = link_sample.draw(other, DAY, size=60)
    other.close()
    tenders = [x for x in links if x.kind == "tender"]
    assert len(tenders) > 7
    assert tenders == [x for x in full if x.kind == "tender"][:len(tenders)]


def test_an_empty_database_draws_the_dataset_pages_alone(conn):
    links = link_sample.draw(conn, DAY)
    assert len(links) == 2 * len(link_sample.DATASETS)
    assert {x.kind for x in links} == {"portal"} and all(x.ref.startswith("dataset:") for x in links)
    assert link_sample.draw(conn, DAY, size=3) == links[:3]
    assert link_sample.draw(conn, DAY, size=0) == []


def test_a_draw_never_takes_more_than_a_table_holds(conn):
    fill(conn, n=3)
    links = link_sample.draw(conn, DAY, size=500)
    counts = {k: sum(1 for x in links if x.kind == k) for k in link_sample.KINDS}
    # Every linked record once, then the kind is done.
    assert counts == {"tender": 3, "award": 3, "contract": 3, "grant": 3, "lobbying": 3,
                      "portal": 2 * len(link_sample.DATASETS) + 2 * 3}


# -- the checks -----------------------------------------------------------------------


class Answer:
    def __init__(self, status: int, headers: dict | None = None) -> None:
        self.status_code = status
        self.headers = headers or {}
        self.closed = False

    def close(self) -> None:
        self.closed = True


class Clock:
    """A clock that moves only when the code sleeps or a request takes time."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


class Session:
    """Answers each address from a script, one entry per request, the last entry
    repeated; an exception in the script is raised. Records every request."""

    def __init__(self, script: dict[str, list], clock: Clock | None = None, took: float = 0.2) -> None:
        self.script = {url: list(entries) for url, entries in script.items()}
        self.calls: list[dict] = []
        self.clock = clock
        self.took = took

    def _answer(self, method: str, url: str, **kw):
        self.calls.append({"method": method, "url": url, **kw})
        if self.clock is not None:
            self.clock.now += self.took
        entries = self.script.get(url) or [Answer(200)]
        entry = entries.pop(0) if len(entries) > 1 else entries[0]
        if isinstance(entry, BaseException):
            raise entry
        return entry

    def head(self, url, **kw):
        return self._answer("HEAD", url, **kw)

    def get(self, url, **kw):
        return self._answer("GET", url, **kw)

    def close(self) -> None:
        pass


A = Link("tender", "cb-1", "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-1")
B = Link("contract", "pspc:C-1", "https://search.open.canada.ca/contracts/?search_text=C-1")


def check(script, link=A):
    clock = Clock()
    session = Session(script, clock)
    result = link_sample.check_link(session, link, link_sample.Spacer(clock.sleep, clock), sleep=clock.sleep, clock=clock)
    return result, session, clock


def test_a_link_is_asked_with_head_the_pipeline_user_agent_and_a_ten_second_timeout():
    result, session, clock = check({A.url: [Answer(200)]})
    assert (result.status, result.method, result.attempts, result.error, result.broken) == (200, "HEAD", 1, None, False)
    assert result.elapsed_ms == 200
    [call] = session.calls
    assert call["method"] == "HEAD" and call["headers"] == {"User-Agent": config.USER_AGENT}
    assert call["timeout"] == link_sample.TIMEOUT_S == 10 and call["allow_redirects"] is True
    assert clock.slept == []


@pytest.mark.parametrize("refused", [405, 501])
def test_a_server_that_refuses_head_is_asked_with_a_get_whose_body_is_never_read(refused):
    head, got = Answer(refused), Answer(404)
    result, session, _ = check({A.url: [head, got]})
    assert [c["method"] for c in session.calls] == ["HEAD", "GET"]
    assert session.calls[1]["stream"] is True and session.calls[1]["headers"]["User-Agent"] == config.USER_AGENT
    assert head.closed and got.closed
    assert (result.status, result.method, result.attempts, result.broken) == (404, "GET", 1, True)


@pytest.mark.parametrize("status, broken", [(404, True), (410, True), (403, False), (401, False), (301, False)])
def test_only_404_and_410_are_broken_and_neither_is_asked_again(status, broken):
    result, session, clock = check({A.url: [Answer(status)]})
    assert result.broken is broken and result.attempts == 1 and len(session.calls) == 1 and clock.slept == []


def test_no_answer_is_asked_once_more_after_a_wait():
    result, session, clock = check({A.url: [requests.ConnectTimeout("slow"), Answer(200)]})
    assert (result.status, result.attempts, result.error) == (200, 2, None)
    assert link_sample.RETRY_WAIT_S in clock.slept
    # One retry and no more.
    result, session, _ = check({A.url: [requests.ConnectionError("reset")]})
    assert (result.status, result.attempts, result.error, result.broken) == (None, 2, "ConnectionError", False)
    assert len(session.calls) == 2


def test_a_retry_after_is_honoured_up_to_its_bound():
    result, _, clock = check({A.url: [Answer(503, {"Retry-After": "12"}), Answer(200)]})
    assert (result.status, result.attempts) == (200, 2) and 12.0 in clock.slept
    # A host that asks for longer than the bound is not asked again tonight.
    result, session, clock = check({A.url: [Answer(429, {"Retry-After": "3600"}), Answer(200)]})
    assert (result.status, result.attempts, len(session.calls)) == (429, 1, 1)
    assert clock.slept == []


def test_a_fault_costs_the_check_and_never_raises():
    result, _, _ = check({A.url: [ValueError("odd answer")]})
    assert result.status is None and result.error == "ValueError" and result.attempts == 2


def test_two_requests_to_one_host_are_spaced():
    clock = Clock()
    session = Session({}, clock, took=0.1)
    second = Link("tender", "cb-2", "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-2")
    checks = link_sample.check_all(session, [A, B, second], sleep=clock.sleep, clock=clock)
    assert [c.status for c in checks] == [200, 200, 200]
    assert [c["url"] for c in session.calls] == [A.url, B.url, second.url]
    # A and second share a host: the gap before second is made up to the host's delay.
    assert clock.slept == [pytest.approx(config.DEFAULT_DELAY - 0.2)]


def test_no_check_starts_after_the_budget():
    clock = Clock()
    session = Session({}, clock, took=100.0)
    links = [Link("portal", f"dataset:{i}", f"https://open.canada.ca/data/en/dataset/{i}") for i in range(5)]
    checks = link_sample.check_all(session, links, budget=250.0, sleep=clock.sleep, clock=clock)
    assert len(checks) == 3
    assert link_sample.outcome_text(checks, len(links)) == "checked 3, 0 broken, 2 not checked (time limit)"


def test_the_budget_leaves_room_inside_the_steps_limit():
    # The slowest check: two attempts of HEAD then GET at the full timeout, and the longest wait between.
    slowest = link_sample.ATTEMPTS * 2 * link_sample.TIMEOUT_S + link_sample.RETRY_MAX_WAIT_S
    workflow = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "nightly.yml").read_text(encoding="utf-8")
    step = workflow.split("- name: Sample the outbound links", 1)[1].split("\n      - ", 1)[0]
    minutes = int(re.search(r"timeout-minutes: (\d+)", step).group(1))
    assert link_sample.BUDGET_S + slowest + 30 < minutes * 60


# -- the record and the command -------------------------------------------------------


def checks_of(*pairs):
    return [link_sample.Check(link, status, "HEAD", 120, 1, None if status else "ReadTimeout") for link, status in pairs]


def test_the_checks_are_kept_sixty_days(conn):
    old = ("2026-09-05T13:09:59Z", "2026-09-05T13:10:00Z", "2026-10-01T00:00:00Z")
    for stamp in old:
        conn.execute("INSERT INTO link_checks (checked_at, data_date, kind, record_ref, url, method, status, elapsed_ms, "
                     "attempts) VALUES (?, '2026-09-05', 'tender', 'cb-0', 'https://x.invalid/', 'HEAD', 200, 1, 1)",
                     (stamp,))
    dropped = link_sample.record(conn, checks_of((A, 404), (B, None)), DAY, STAMP)
    assert link_sample.RETENTION_DAYS == 60 and dropped == 1
    rows = conn.execute("SELECT checked_at, data_date, kind, record_ref, url, method, status, error, elapsed_ms, attempts "
                        "FROM link_checks ORDER BY id").fetchall()
    assert [r["checked_at"] for r in rows] == [*old[1:], STAMP, STAMP]
    assert tuple(rows[-2]) == (STAMP, DAY, "tender", "cb-1", A.url, "HEAD", 404, None, 120, 1)
    assert tuple(rows[-1])[6:8] == (None, "ReadTimeout")


def test_the_outcome_line():
    assert link_sample.outcome_text(checks_of((A, 200), (B, 404)), 2) == "checked 2, 1 broken"
    assert link_sample.outcome_text(checks_of((A, None), (B, 410)), 4) == \
        "checked 2, 1 broken, 1 with no answer, 2 not checked (time limit)"
    assert link_sample.outcome_text([], 0) == "checked 0, 0 broken"


def test_a_run_writes_its_outcome_the_broken_links_and_the_rows(conn, tmp_path):
    fill(conn)
    links = link_sample.draw(conn, DAY)
    gone = [x for x in links if x.kind == "award"][:2]
    script = {gone[0].url: [Answer(404)], gone[1].url: [Answer(405), Answer(410)]}
    clock = Clock()
    out = tmp_path / "links"
    out.mkdir()
    (out / link_sample.BROKEN_FILE).write_text('{"broken": [{"stale": true}]}', encoding="utf-8")
    result = link_sample.run(conn, out, Session(script, clock), data_date=DAY, now=STAMP,
                             sleep=clock.sleep, clock=clock)
    assert (out / link_sample.OUTCOME).read_text(encoding="utf-8") == "checked 40, 2 broken\n"
    written = json.loads((out / link_sample.BROKEN_FILE).read_text(encoding="utf-8"))
    assert written == {"data_date": DAY, "checked_at": STAMP, "checked": 40, "broken": [
        {"kind": "award", "ref": gone[0].ref, "url": gone[0].url, "status": 404},
        {"kind": "award", "ref": gone[1].ref, "url": gone[1].url, "status": 410},
    ]}
    assert result["outcome"] == "checked 40, 2 broken" and sum(result["drawn"].values()) == 40
    assert tuple(conn.execute("SELECT COUNT(*), COUNT(DISTINCT checked_at) FROM link_checks").fetchone()) == (40, 1)
    assert conn.execute("SELECT method FROM link_checks WHERE status = 410").fetchone()[0] == "GET"


def test_a_run_that_stops_reads_as_failed_and_leaves_no_broken_list(conn, tmp_path, monkeypatch):
    out = tmp_path / "links"
    out.mkdir()
    (out / link_sample.BROKEN_FILE).write_text('{"broken": []}', encoding="utf-8")

    def boom(*a, **kw):
        raise RuntimeError("database locked")

    monkeypatch.setattr(link_sample, "draw", boom)
    with pytest.raises(RuntimeError):
        link_sample.run(conn, out, Session({}), data_date=DAY)
    assert (out / link_sample.OUTCOME).read_text(encoding="utf-8") == "failed\n"
    assert not (out / link_sample.BROKEN_FILE).exists()


def test_the_command_seeds_by_the_data_date_and_exits_0_with_broken_links(tmp_path, monkeypatch, capsys):
    db = tmp_path / "awardwatch.sqlite"
    conn = connect(db)
    fill(conn)
    set_meta(conn, "data_as_of", DAY)
    conn.commit()
    expected = link_sample.draw(conn, DAY)
    conn.close()
    gone = expected[0]
    sessions: list[Session] = []

    def fake_session():
        sessions.append(Session({gone.url: [Answer(404)]}))
        return sessions[-1]

    # No request leaves the test: the command's session is the fake, and the waits are skipped.
    monkeypatch.setattr(link_sample.requests, "Session", fake_session)
    real_run = link_sample.run
    monkeypatch.setattr(link_sample, "run", lambda *a, **kw: real_run(*a, sleep=lambda s: None, **kw))
    out = tmp_path / "out" / "links"
    assert cli.main([link_sample.COMMAND, "--db", str(db), "--out", str(out)]) == 0
    assert [c["url"] for c in sessions[0].calls] == [x.url for x in expected]
    assert (out / link_sample.OUTCOME).read_text(encoding="utf-8") == "checked 40, 1 broken\n"
    printed = capsys.readouterr().out
    assert "link-sample: checked 40, 1 broken" in printed
    assert f"broken: {gone.kind} {gone.ref} (404) {gone.url}" in printed
    # --size and --data-date draw another night again.
    assert cli.main([link_sample.COMMAND, "--db", str(db), "--out", str(out), "--size", "5",
                     "--data-date", "2026-11-01"]) == 0
    conn = connect(db)
    assert [c["url"] for c in sessions[1].calls] == [x.url for x in link_sample.draw(conn, "2026-11-01", 5)]
    assert conn.execute("SELECT COUNT(*) FROM link_checks").fetchone()[0] == 45
    conn.close()


def test_the_parser_defaults():
    args = cli.build_parser().parse_args([link_sample.COMMAND])
    assert (args.db, args.out, args.size, args.budget, args.data_date) == (
        None, None, link_sample.SAMPLE_SIZE, link_sample.BUDGET_S, None)
