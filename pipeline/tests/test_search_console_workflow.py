"""The Search Console import inside the nightly workflow: its command and the run status.

The command lives in nightly.py with the other commands the workflow calls
between its steps; test_search_console.py covers the import itself.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import requests

from awardwatch_pipeline import config, nightly, resilience, search_console as sc
from test_search_console import ACCOUNT_JSON, FakeGoogle

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "nightly.yml"


def step(text: str, name: str) -> str:
    return text.split(f"- name: {name}", 1)[1].split("\n      - ", 1)[0]


def code(block: str) -> str:
    return "\n".join(ln for ln in block.splitlines() if not ln.lstrip().startswith("#"))


def test_the_step_keeps_four_private_files_by_the_append_rule_and_prints_no_figure():
    text = WORKFLOW.read_text(encoding="utf-8")
    gsc = step(text, "Import the Search Console figures (only when GSC_SERVICE_ACCOUNT_JSON is set)")
    body = code(gsc)
    # The secret reaches the step as an env line, as before, and nothing else does.
    env = gsc.split("        env:\n", 1)[1].split("        run: |", 1)[0]
    assert [ln.strip() for ln in env.strip().splitlines()] == [
        "GSC_SERVICE_ACCOUNT_JSON: ${{ secrets.GSC_SERVICE_ACCOUNT_JSON }}", "GSC_SITE: ${{ vars.GSC_SITE }}"]
    assert "continue-on-error: true" in gsc and "if: ${{ !cancelled() }}" in gsc
    # Each outcome reads "failed" until its files are in R2.
    first = body.index("python -m awardwatch_pipeline.nightly import-search-console")
    for name in ("last_outcome", "detail_last_outcome", "index_last_outcome"):
        assert body.index(f'echo "failed" > "$out/{name}.txt"') < first, name
    # Every file is downloaded first, the step stopped by any failure but "does not exist".
    assert 'for f in search_console.csv search_pages.csv search_queries.csv index_sample.csv; do' in body
    assert '"$WRANGLER" r2 object get --remote "$BUCKET/views/$1" --file "$out/$1"' in body
    assert 'if grep -qi "specified key does not exist" "$out/get.log"; then rm -f "$out/$1"; return 2; fi' in body
    assert body.index("for f in search_console.csv") < first
    # Each put only on its own outcome, after the command.
    puts = re.findall(r'r2 object put --remote "\$BUCKET/([^"]+)" --file "\$out/([^"]+)"', body)
    assert puts == [("views/search_console.csv", "search_console.csv"), ("views/search_pages.csv", "search_pages.csv"),
                    ("views/search_queries.csv", "search_queries.csv"), ("views/index_sample.csv", "index_sample.csv")]
    assert all(body.index(f'"$BUCKET/{key}"') > first for key, _ in puts)
    assert body.index("imported*)") < body.index('"$BUCKET/views/search_console.csv"')
    assert body.index("inspected*)") < body.index('"$BUCKET/views/index_sample.csv"')
    # No file's content and no outcome file is printed to the public log (the download's error log aside).
    for shown in ("cat \"$out/search", "cat \"$out/index_sample", "cat \"$out/outcome", "$GITHUB_STEP_SUMMARY"):
        assert shown not in body.replace('outcome=$(cat "$out/outcome.txt")', ""), shown
    # The run status reads both new words; LAST_RUN.md carries the words and nothing else.
    status = step(text, "Write the run status")
    assert "--search-detail-outcome data/out/search_console/detail_last_outcome.txt" in status
    assert "--index-sample-outcome data/out/search_console/index_last_outcome.txt" in status
    record = code(step(text, "Record the run so the schedule stays enabled"))
    assert ('echo "Search Console by page and query: $(cat data/out/search_console/detail_last_outcome.txt)" '
            '>> LAST_RUN.md') in record
    assert 'echo "Index sample: $(cat data/out/search_console/index_last_outcome.txt)" >> LAST_RUN.md' in record
    for private in ("search_pages", "search_queries", "index_sample.csv"):
        assert private not in record, private


@pytest.fixture(autouse=True)
def site(monkeypatch):
    # The property is the domain of the site's address; the default address is a placeholder with none.
    monkeypatch.setattr(config, "SITE_URL", "https://awardwatch.ca")


# -- the command and the run status --------------------------------------------


def test_the_command_writes_its_outcome_and_exits_1_only_when_failed(tmp_path, monkeypatch):
    monkeypatch.delenv(sc.SECRET_ENV, raising=False)
    assert nightly.main(["import-search-console", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "outcome.txt").read_text(encoding="utf-8") == "no credentials\n"
    monkeypatch.setenv(sc.SECRET_ENV, "{broken")
    assert nightly.main(["import-search-console", "--out", str(tmp_path)]) == 1
    assert (tmp_path / "outcome.txt").read_text(encoding="utf-8") == "failed\n"
    fake = FakeGoogle()
    monkeypatch.setattr(requests, "Session", lambda: fake)
    monkeypatch.setenv(sc.SECRET_ENV, ACCOUNT_JSON)
    assert nightly.main(["import-search-console", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "outcome.txt").read_text(encoding="utf-8").startswith("imported ")
    assert fake.closed


def test_the_run_status_carries_the_import_and_only_failed_needs_attention(tmp_path):
    db = tmp_path / "none.sqlite"
    status = nightly.run_status(db, None, None, {}, search_console="no credentials")
    assert status["search_console"] == "no credentials"
    assert nightly.run_status(db, None, None, {})["search_console"] == "not run"
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
