"""The run command: every stage in order, one log row each, stubs as notices, no request on a samples run."""

from awardwatch_pipeline import cli
from awardwatch_pipeline.normalize import org_id

SAMPLE_NAMES = {
    "canadabuys_tenders_new.csv": "newTenderNotice.csv",
    "canadabuys_awards.csv": "2026-2027-awardNotice.csv",
    "canadabuys_history.csv": "2026-2027-contractHistory.csv",
}


def samples_dir(fixtures, tmp_path):
    for fixture, sample in SAMPLE_NAMES.items():
        (tmp_path / sample).write_bytes((fixtures / fixture).read_bytes())
    return tmp_path


def test_a_samples_run_logs_every_stage_once(conn, fixtures, tmp_path, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("a samples run made a request")

    monkeypatch.setattr(cli, "PoliteClient", no_network)
    assert cli.run(conn, [], samples=samples_dir(fixtures, tmp_path)) == 0
    rows = conn.execute("SELECT source, ok, notice, rows_in, excluded FROM sources_log ORDER BY id").fetchall()
    assert [r["source"] for r in rows] == cli.STAGES
    assert all(r["ok"] == 1 for r in rows)
    stubs = {"contracts", "grants", "lobbying", "indicators", "export"}
    for r in rows:
        if r["source"] in stubs:
            assert r["notice"] == f"the {r['source']} stage is not built yet"
    by = {r["source"]: r for r in rows}
    assert by["tenders"]["rows_in"] == 25 and by["awards"]["excluded"] == 1 and by["history"]["excluded"] == 1
    assert "samples run" in by["buyers"]["notice"] and "not downloaded" in by["registry"]["notice"]
    simex = conn.execute("SELECT display_name, n_awards FROM organizations WHERE id = ?",
                         (org_id("simex defence"),)).fetchone()
    assert tuple(simex) == ("Simex Defence Inc.", 5)


def test_selected_stages_run_alone_and_a_failure_does_not_stop_the_rest(conn, monkeypatch):
    calls = []

    def boom():
        raise RuntimeError("broken stage")

    runners = {stage: (lambda s=stage: calls.append(s)) for stage in cli.STAGES}
    runners["tenders"] = boom
    monkeypatch.setattr(cli, "stage_runners", lambda conn, client, samples: runners)
    assert cli.run(conn, ["organizations", "tenders", "awards"], samples=object()) == 1
    assert calls == ["awards", "organizations"]
    failed = conn.execute("SELECT source, ok, detail FROM sources_log").fetchall()
    assert [tuple(r) for r in failed] == [("tenders", 0, "RuntimeError: broken stage")]


def test_the_parser_has_a_flag_per_stage_and_samples():
    args = cli.build_parser().parse_args(["run", "--tenders", "--export", "--samples", "--db", "x.sqlite"])
    assert args.tenders and args.export and args.samples and not args.awards and args.db == "x.sqlite"
