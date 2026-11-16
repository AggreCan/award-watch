"""The tests workflow (.github/workflows/tests.yml) runs the suites on GitHub's runner when it is started by hand
and can do nothing else: no secret, no write permission, no deploy, and only the commands that are the suites
themselves."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "tests.yml"

ALLOWED_ACTIONS = {"actions/checkout@v4", "actions/setup-python@v5", "actions/setup-node@v4"}
# Every command a step may run, whole.
ALLOWED_RUNS = {"npm ci", "npm run typecheck", "npm test", "npm run test:mail", 'pip install -e "./pipeline[dev]"', "pytest"}


def body() -> str:
    """The workflow without its comments."""
    return "\n".join(line for line in WORKFLOW.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#"))


def test_it_runs_on_request_only():
    text = body()
    on = text[text.index("\non:"):text.index("\npermissions:")]
    assert re.findall(r"^  (\w+):", on, re.M) == ["workflow_dispatch"]
    assert "schedule" not in text and "pull_request" not in text and "push:" not in text


def test_it_reads_the_repository_and_holds_no_secret():
    text = body()
    assert re.findall(r"^permissions:\n((?:  .+\n)+)", text, re.M) == ["  contents: read\n"]
    assert text.count("permissions:") == 1
    assert "secrets." not in text and "vars." not in text and "github.token" not in text
    assert "persist-credentials: false" in text
    assert text.count("persist-credentials: false") == text.count("actions/checkout@v4")


def test_it_uses_only_the_allowed_actions_and_runs_only_the_suites():
    text = body()
    assert set(re.findall(r"uses:\s*(\S+)", text)) <= ALLOWED_ACTIONS
    runs = [r.strip() for r in re.findall(r"^\s+run:\s*(.+)$", text, re.M)]
    assert "|" not in "".join(runs), "a multi-line run block: list its commands in ALLOWED_RUNS instead"
    assert set(runs) == ALLOWED_RUNS
    for word in ("wrangler", "deploy", "curl", "git push", "gh "):
        assert word not in text, word


def test_the_site_job_runs_the_checks_the_site_package_names():
    package = (ROOT / "site" / "package.json").read_text(encoding="utf-8")
    for script in ("typecheck", "test", "test:mail"):
        assert f'"{script}":' in package, script
    pyproject = (ROOT / "pipeline" / "pyproject.toml").read_text(encoding="utf-8")
    assert 'dev = ["pytest' in pyproject


def test_the_workflow_text_has_no_dashes():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "—" not in text and "–" not in text
