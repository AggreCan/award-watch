"""The Search Console import inside the nightly workflow: its command and the run status.

Moved out of test_search_console.py while cli's import-search-console command,
nightly.py and resilience.py are not adapted; it moves back beside it when
they are.
"""

from __future__ import annotations

import json

import requests

from pmw_pipeline import cli, nightly, resilience, search_console as sc
from test_search_console import ACCOUNT_JSON, FakeGoogle


# -- the command and the run status --------------------------------------------


def test_the_command_writes_its_outcome_and_exits_1_only_when_failed(tmp_path, monkeypatch):
    monkeypatch.delenv(sc.SECRET_ENV, raising=False)
    assert cli.main(["import-search-console", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "outcome.txt").read_text(encoding="utf-8") == "no credentials\n"
    monkeypatch.setenv(sc.SECRET_ENV, "{broken")
    assert cli.main(["import-search-console", "--out", str(tmp_path)]) == 1
    assert (tmp_path / "outcome.txt").read_text(encoding="utf-8") == "failed\n"
    fake = FakeGoogle()
    monkeypatch.setattr(requests, "Session", lambda: fake)
    monkeypatch.setenv(sc.SECRET_ENV, ACCOUNT_JSON)
    assert cli.main(["import-search-console", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "outcome.txt").read_text(encoding="utf-8").startswith("imported ")
    assert fake.closed


def test_the_run_status_carries_the_import_and_only_failed_needs_attention(tmp_path):
    db = tmp_path / "none.sqlite"
    status = nightly.run_status(db, None, None, None, {}, search_console="no credentials")
    assert status["search_console"] == "no credentials"
    assert nightly.run_status(db, None, None, None, {})["search_console"] == "not run"
    clean = {"stages": [], "search_console": "imported 3 days"}
    assert resilience.attention_items(clean) == []
    assert resilience.attention_items({**clean, "search_console": "no credentials"}) == []
    assert resilience.attention_items({**clean, "search_console": "failed"}) == [
        "Search Console import: failed (caught up next run)"]
    (tmp_path / "gsc.txt").write_text("imported 2 days\n", encoding="utf-8")
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(db), "--search-console-outcome", str(tmp_path / "gsc.txt"),
                         "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["search_console"] == "imported 2 days"
