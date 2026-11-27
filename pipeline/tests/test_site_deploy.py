"""The site-only deploy: the bundle check that proves the static bundle in R2
(static.tar.gz, saved in parts) is what the site serves, and the guard on
.github/workflows/deploy-site.yml that keeps that workflow from ever writing
data and from deploying a commit that fails its checks.

The guard allows these commands and no others: Wrangler's gets of the
bundle's manifest and parts, deployments status, deploy (with the
arguments ARGUMENT_LINES set: the two --var and the commit's --tag and
--message) and rollback; the nightly helpers live-version, smoke,
site-bundle-check and join; npm ci and the site's three checks (npm run
typecheck, npm test, npm run test:mail, each a step of its own after npm ci
and before the bundle download, never allowed to fail); git rev-parse HEAD
for the commit the deploy names. It also plants each forbidden change in a
copy of the file and checks that the guard catches it.

The workflow checks are textual: PyYAML is not a dependency of the pipeline
(pyproject.toml), so the file is read line by line. Comment lines are left
out of every check; anything on a line that runs is in."""

import json
import re
from pathlib import Path

import pytest

from awardwatch_pipeline import nightly, resilience

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-site.yml"
NIGHTLY = ROOT / ".github" / "workflows" / "nightly.yml"
BASE = "https://awardwatch.example"

STATS = {"data_as_of": "2026-10-22", "counts": {"organizations": 91234},
         "top_organizations_year": [{"id": "org-a000000005", "name": "Example Works Ltd", "n": 3, "total": 125000.0}]}
OPEN = [{"reference": "cb-100-10000001", "amendment": 1, "title_en": "Snow removal", "provinces": ["BC", "ON"],
         "segments": ["72"], "closing": "2026-11-04T14:00:00"}]


class Resp:
    def __init__(self, status, content=b""):
        self.status_code = status
        self.content = content


class FakeHttp:
    """Answers by exact URL from a queue (the last answer repeats); an
    exception in the queue is raised. Records every call."""

    def __init__(self, routes):
        self.routes = {url: list(v) if isinstance(v, list) else [v] for url, v in routes.items()}
        self.calls = []

    def get(self, url, headers=None, timeout=None, **kwargs):
        self.calls.append((url, dict(headers or {})))
        queue = self.routes.get(url)
        if queue is None:
            return Resp(404)
        answer = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(answer, Exception):
            raise answer
        return answer

    def close(self):
        pass


def body(data, **dump):
    return Resp(200, json.dumps(data, **dump).encode("utf-8"))


def make_bundle(folder, stats=STATS, open_rows=OPEN):
    (folder / "tenders").mkdir(parents=True, exist_ok=True)
    for rel, data in (("stats.json", stats), ("tenders/open.json", open_rows)):
        if data is not None:
            (folder / rel).write_text(json.dumps(data), encoding="utf-8")
    return folder


def live(**overrides):
    routes = {f"{BASE}/data/stats.json": body(STATS, indent=2),
              f"{BASE}/data/tenders/open.json": body(OPEN)}
    routes.update({f"{BASE}/data/{k.replace('__', '/')}": v for k, v in overrides.items()})
    return FakeHttp(routes)


def check(http, bundle, saved=None):
    waits = []
    record, live_stats = resilience.bundle_check(http, BASE, bundle, saved, sleep=waits.append, retry_after=10)
    return record, live_stats, waits


def results(record):
    return {(f["file"], f["against"]): f["result"] for f in record["files"]}


# -- the bundle check ----------------------------------------------------------


def test_an_archive_equal_to_the_live_files_passes(tmp_path):
    bundle = make_bundle(tmp_path / "static")
    # The live stats.json is laid out differently and its keys come in
    # another order; as parsed JSON it is the same value.
    http = live(**{"stats.json": Resp(200, json.dumps(dict(reversed(list(STATS.items()))), indent=4).encode())})
    record, live_stats, waits = check(http, bundle)
    assert record["ok"] is True and waits == []
    assert [f["result"] for f in record["files"]] == ["same", "same"]
    assert [u for u, _ in http.calls] == [f"{BASE}/data/{rel}" for rel in resilience.BUNDLE_FILES]
    assert all(h["User-Agent"].startswith("AwardWatch/") and h["Cache-Control"] == "no-cache" for _, h in http.calls)
    assert json.loads(live_stats) == STATS


@pytest.mark.parametrize("rel, changed", [
    ("stats.json", dict(STATS, data_as_of="2026-10-23")),
    ("tenders/open.json", [dict(OPEN[0], provinces=["BC"])]),
    # A change of type is a difference even where Python would call it equal.
    ("tenders/open.json", [dict(OPEN[0], amendment=True)]),
    ("tenders/open.json", [dict(OPEN[0], amendment=1.0)]),
])
def test_a_file_that_differs_fails_and_is_named(tmp_path, rel, changed):
    bundle = make_bundle(tmp_path / "static")
    http = live(**{rel.replace("/", "__"): body(changed)})
    record, _, _ = check(http, bundle)
    assert record["ok"] is False
    bad = [f for f in record["files"] if f["result"] != "same"]
    assert [(f["file"], f["result"]) for f in bad] == [(rel, "differs")]
    assert bad[0]["note"] == f"{rel}: the archive and {BASE}/data/{rel} differ"


def test_a_file_missing_from_the_archive_fails_without_asking_the_site(tmp_path):
    bundle = make_bundle(tmp_path / "static", open_rows=None)
    http = live()
    record, _, _ = check(http, bundle)
    assert record["ok"] is False
    assert results(record)[("tenders/open.json", f"{BASE}/data/tenders/open.json")] == "missing"
    assert [f["note"] for f in record["files"] if f["result"] == "missing"] == ["tenders/open.json: not in the archive"]
    assert f"{BASE}/data/tenders/open.json" not in [u for u, _ in http.calls]


def test_a_file_the_site_does_not_serve_fails(tmp_path):
    bundle = make_bundle(tmp_path / "static")
    record, _, waits = check(FakeHttp({f"{BASE}/data/stats.json": body(STATS)}), bundle)
    assert record["ok"] is False
    rows = [f for f in record["files"] if f["file"] == "tenders/open.json"][0]
    assert rows["result"] == "unreachable" and rows["note"] == f"tenders/open.json: {BASE}/data/tenders/open.json answered 404"
    assert waits == [10]


@pytest.mark.parametrize("answer, note", [
    (Resp(503, b"busy"), "answered 503"),
    (Resp(403, b"<title>Attention Required! | Cloudflare</title>"), "answered 403"),
    (ConnectionError("no route to host"), "no answer (ConnectionError)"),
])
def test_an_http_error_fails_after_one_more_try(tmp_path, answer, note):
    bundle = make_bundle(tmp_path / "static")
    http = live(**{"stats.json": answer})
    record, live_stats, waits = check(http, bundle)
    assert record["ok"] is False and live_stats is None
    stats = [f for f in record["files"] if f["file"] == "stats.json"][0]
    assert stats["result"] == "unreachable" and stats["note"].endswith(note)
    assert waits == [10] and [u for u, _ in http.calls].count(f"{BASE}/data/stats.json") == 2


def test_an_error_that_clears_on_the_second_try_passes(tmp_path):
    bundle = make_bundle(tmp_path / "static")
    http = live(**{"tenders__open.json": [Resp(502, b"bad gateway"), body(OPEN)]})
    record, _, waits = check(http, bundle)
    assert record["ok"] is True and waits == [10]


def test_a_body_that_is_not_json_fails(tmp_path):
    bundle = make_bundle(tmp_path / "static")
    (bundle / "tenders" / "open.json").write_text("{not json", encoding="utf-8")
    http = live(**{"stats.json": Resp(200, b"<html>a page, not the file</html>")})
    record, _, _ = check(http, bundle)
    notes = {f["file"]: f["note"] for f in record["files"] if f["result"] == "unreadable"}
    assert record["ok"] is False
    assert notes == {"stats.json": f"stats.json: {BASE}/data/stats.json is not JSON",
                     "tenders/open.json": "tenders/open.json: the archive's copy is not JSON"}


def test_the_saved_stats_are_compared_as_well(tmp_path):
    bundle = make_bundle(tmp_path / "static")
    saved = tmp_path / "stats.before.json"
    saved.write_bytes(json.dumps(STATS, indent=2).encode())
    record, _, _ = check(live(), bundle, saved)
    assert record["ok"] is True
    assert results(record)[("stats.json", resilience.SAVED_LABEL)] == "same"
    saved.write_bytes(json.dumps(dict(STATS, data_as_of="2026-10-21")).encode())
    record, _, _ = check(live(), bundle, saved)
    assert record["ok"] is False
    assert results(record)[("stats.json", resilience.SAVED_LABEL)] == "differs"
    record, _, _ = check(live(), bundle, tmp_path / "never-written.json")
    assert record["ok"] is False
    assert results(record)[("stats.json", resilience.SAVED_LABEL)] == "unreachable"


def test_site_bundle_check_command(tmp_path, monkeypatch, caplog):
    bundle = make_bundle(tmp_path / "static")
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    kept = tmp_path / "work" / "stats.before.json"
    monkeypatch.setattr(nightly, "_session", lambda: live())
    args = ["site-bundle-check", "--bundle", str(bundle), "--base-url", BASE, "--retry-after", "0"]
    assert nightly.main(args + ["--keep-live-stats", str(kept), "--title", "Before the deploy"]) == 0
    assert json.loads(kept.read_bytes()) == STATS
    text = summary.read_text(encoding="utf-8")
    assert text.startswith("#### Before the deploy\n") and text.count("| same |") == 2

    # After the deploy: the live open notices changed, so the command fails,
    # names the file in the log and the summary, and keeps nothing.
    monkeypatch.setattr(nightly, "_session", lambda: live(**{"tenders__open.json": body([])}))
    kept.unlink()
    assert nightly.main(args + ["--saved-stats", str(tmp_path / "work" / "missing.json"),
                                "--keep-live-stats", str(kept)]) == 1
    assert not kept.exists()
    assert f"tenders/open.json: the archive and {BASE}/data/tenders/open.json differ" in caplog.text
    text = summary.read_text(encoding="utf-8")
    assert "| tenders/open.json | https://awardwatch.example/data/tenders/open.json | differs |" in text
    assert "| stats.json | the copy saved before the deploy | unreachable |" in text
    assert "2 of 3 comparisons failed" in text


# -- the workflow guard ----------------------------------------------------------

ALLOWED_SECRETS = {"CLOUDFLARE_SITE_DEPLOY_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "MAIL_TEST_TO", "AWARDWATCH_CHECK_KEY"}
# The key the smoke test sends past the zone's challenge (resilience.CHECK_KEY_ENV): this line, on the smoke step alone,
# whose command is SMOKE_RUN against SITE (the smoke test sends the key only to the site's own https host).
CHECK_KEY_LINE = "AWARDWATCH_CHECK_KEY: ${{ secrets.AWARDWATCH_CHECK_KEY }}"
SMOKE_RUN = ('python -m awardwatch_pipeline.nightly smoke --base-url "$SITE" --stats site/public/data/stats.json '
             '--out "$WORK/smoke.json"')
SITE_ENV = "SITE: ${{ vars.SITE_URL || 'https://awardwatch.ca' }}"
ALLOWED_ACTIONS = {"actions/checkout@v4", "actions/setup-python@v5", "actions/setup-node@v4"}
TOKEN_LINE = "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_SITE_DEPLOY_TOKEN }}"
WRANGLER_ENV = "WRANGLER: ${{ github.workspace }}/site/node_modules/.bin/wrangler"
# Every form a Wrangler call may take, matched against what follows "$WRANGLER".
# The bundle is read as its manifest and then the parts the manifest lists,
# both from R2 with --remote and both into the work folder.
ALLOWED_WRANGLER = {
    "r2 object get of the manifest": re.compile(
        r'r2 object get --remote "\$BUCKET/static\.tar\.gz\.parts" --file "\$WORK/static\.tar\.gz\.parts" '),
    "r2 object get of a part": re.compile(r'r2 object get --remote "\$BUCKET/\$part" --file "\$WORK/\$part" '),
    "deployments status": re.compile(r"deployments status --json "),
    # "$@" holds the landing page's Brandfetch client id and the mail check's test inbox as --var, or nothing (ARGUMENT_LINES).
    "deploy": re.compile(r'deploy "\$@"; '),
    "rollback": re.compile(r'rollback "\$VERSION_ID" --message "[^"$`\\]*" --yes; '),
}
ALLOWED_NIGHTLY = {"live-version", "smoke", "site-bundle-check", "join"}
# The only line that gives part a value: the manifest's names, kept only when
# they are static.tar.gz.NNN, before any of them reaches a key or a path.
PART_LOOP = r"""for part in $(awk '{print $2}' "$WORK/static.tar.gz.parts" | grep -E '^static\.tar\.gz\.[0-9]{3}$'); do"""
PART_BINDING = re.compile(r"\bfor\s+part\b|(?<![\w$])part=|\bread\s+(?:-\w+\s+)*part\b")
# The only lines that set the deploy's arguments ("$@"): none, the landing
# page's Brandfetch client id as a Worker variable (docs/landing.md), read from
# the repository variable through the step's environment, the live mail
# check's test inbox (docs/mail.md), read from the repository secret, so the
# address is masked in the public log, and the commit shipped, read from the
# checked-out tree and never from the dispatcher, as the version's tag (its
# first 12 characters) and message, which the nightly's tests job reads back.
ARGUMENT_LINES = [
    "set --",
    'if [ -n "$BRANDFETCH_CLIENT_ID" ]; then set -- --var "BRANDFETCH_CLIENT_ID:$BRANDFETCH_CLIENT_ID"; fi',
    'if [ -n "$MAIL_TEST_TO" ]; then set -- "$@" --var "MAIL_TEST_TO:$MAIL_TEST_TO"; fi',
    "commit=$(git rev-parse HEAD)",
    'set -- "$@" --tag "${commit:0:12}" --message "commit $commit"',
]
ARGUMENT_BINDING = re.compile(r"\bset\s+--|\bshift\b|\bBRANDFETCH_CLIENT_ID\s*[:=]|\bMAIL_TEST_TO\s*[:=]|\bcommit\s*=")
# The site's three checks, each a single-line run of its own (package.json's scripts).
SUITE_RUNS = ["npm run typecheck", "npm test", "npm run test:mail"]
BRANDFETCH_ENV = "BRANDFETCH_CLIENT_ID: ${{ vars.BRANDFETCH_CLIENT_ID }}"
MAIL_TEST_TO_ENV = "MAIL_TEST_TO: ${{ secrets.MAIL_TEST_TO }}"
FORBIDDEN = [
    ("r2 object put", re.compile(r"r2\s+object\s+put")),
    ("r2 object delete", re.compile(r"r2\s+object\s+delete")),
    ("r2 bucket", re.compile(r"r2\s+bucket")),
    ("a d1 command", re.compile(r"(?<![\w-])d1\s")),
    ("the pipeline's main command line", re.compile(r"awardwatch_pipeline\.cli|python3?\s+-m\s+awardwatch_pipeline(?![.\w])")),
    ("a nightly command that writes state", re.compile(r"awardwatch_pipeline\.nightly\s+(pack|status|attention|gate|restore|verify|checks)\b")),
    ("git push", re.compile(r"git\s+push")),
    ("git commit", re.compile(r"git\s+commit")),
    # The one git command reads the commit the deploy names (ARGUMENT_LINES).
    ("any git command but the commit's read", re.compile(r"(?<![\w/-])git\s(?!rev-parse HEAD\)$)")),
    ("the nightly's token", re.compile(r"secrets\.CLOUDFLARE_API_TOKEN|CF_API_TOKEN")),
    ("the GitHub token", re.compile(r"github\.token|GITHUB_TOKEN|GH_TOKEN")),
    ("the Cloudflare API called directly", re.compile(r"api\.cloudflare\.com")),
    ("curl or wget", re.compile(r"(?<![\w-])(curl|wget)\s")),
    ("npx", re.compile(r"(?<![\w-])npx\s")),
    ("an npm command other than npm ci and the three checks",
     re.compile(r"(?<![\w-])npm\s+(?!(?:ci|run typecheck|test|run test:mail)\s*$)")),
    ("a pip command other than the pipeline install", re.compile(r"(?<![\w-])pip3?\s+(?!install -e \./pipeline\s*$)")),
    ("python other than the allowed nightly commands",
     re.compile(r"(?<![\w-])python3?\s+(?!-m awardwatch_pipeline\.nightly (?:live-version|smoke|site-bundle-check|join)\s)")),
    ("node", re.compile(r"(?<![\w-])node\s")),
    ("the gh command", re.compile(r"(?<![\w-])gh\s")),
    ("LAST_RUN.md", re.compile(r"LAST_RUN")),
    ("status.json", re.compile(r"status\.json")),
    ("a reusable workflow", re.compile(r"workflow_call|secrets:\s*inherit")),
]


def code_lines(text):
    """The lines that do something: blank lines and comment lines dropped."""
    return [line.rstrip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]


def top_block(text, key):
    """(header line, the indented lines under it) for a top-level key."""
    header, block, inside = None, [], False
    for line in code_lines(text):
        if not line[0].isspace():
            inside = line.split(":", 1)[0].strip() == key
            if inside:
                header = line
            continue
        if inside:
            block.append(line)
    return header, block


def child_keys(block):
    if not block:
        return []
    indent = min(len(line) - len(line.lstrip()) for line in block)
    return [line.strip().split(":", 1)[0] for line in block if len(line) - len(line.lstrip()) == indent]


def wrangler_calls(line):
    """What follows each "$WRANGLER" on the line, with a space after it so a
    form ending the line still matches."""
    return [part.strip() + " " for part in re.split(r'"\$WRANGLER"|\$\{WRANGLER\}|\$WRANGLER\b', line)[1:]]


def job_steps(text):
    """The deploy job's steps in order, each as its code lines stripped (the
    first is "- name: ..." or "- uses: ...")."""
    lines = code_lines(text)
    if "    steps:" not in lines:
        return []
    steps = []
    for line in lines[lines.index("    steps:") + 1:]:
        if not line.startswith("      "):
            break
        if line.startswith("      - "):
            steps.append([])
        if steps:
            steps[-1].append(line.strip())
    return steps


def suite_problems(text):
    """Each of the three checks: one step, run alone on a single line in site/,
    never allowed to fail and never behind a condition, after npm ci and
    before the bundle download (so before the version record and the deploy)."""
    problems = []
    steps = job_steps(text)

    def where(pred):
        return [i for i, s in enumerate(steps) if pred(s)]

    install = where(lambda s: "run: npm ci" in s)
    download = where(lambda s: "- name: Download the static bundle from R2" in s)
    for run in SUITE_RUNS:
        at = where(lambda s, run=run: f"run: {run}" in s)
        if len(at) != 1:
            problems.append(f"the step that runs {run} must be there once, its command alone on its run line (found {len(at)})")
            continue
        step = steps[at[0]]
        if "working-directory: site" not in step:
            problems.append(f"{run} must run in site/")
        if any(line.startswith(("continue-on-error", "- continue-on-error")) for line in step):
            problems.append(f"{run} may not be allowed to fail")
        if any(line.startswith(("if:", "- if:")) for line in step):
            problems.append(f"{run} may not run behind a condition")
        if not (len(install) == 1 and len(download) == 1 and install[0] < at[0] < download[0]):
            problems.append(f"{run} must run after npm ci and before the bundle download")
    return problems


def workflow_problems(text, nightly_text=None):
    problems = suite_problems(text)
    lines = code_lines(text)

    header, block = top_block(text, "on")
    if header != "on:" or child_keys(block) != ["workflow_dispatch"]:
        problems.append(f"the only trigger must be workflow_dispatch (found {header!r} {child_keys(block)})")
    header, block = top_block(text, "permissions")
    if header != "permissions:" or [line.strip() for line in block] != ["contents: read"]:
        problems.append("permissions must be contents: read and nothing else")
    if sum(1 for line in lines if re.match(r"\s*permissions\s*:", line)) != 1:
        problems.append("permissions must be set once, at the top")
    header, block = top_block(text, "concurrency")
    if [line.strip() for line in block] != ["group: nightly", "cancel-in-progress: false"]:
        problems.append("concurrency must be the nightly's group, never cancelling")
    if nightly_text is not None:
        _, nblock = top_block(nightly_text, "concurrency")
        if "group: nightly" not in [line.strip() for line in nblock]:
            problems.append("nightly.yml no longer uses the group nightly, so the two could overlap")

    for line in lines:
        for label, pattern in FORBIDDEN:
            if pattern.search(line):
                problems.append(f"{label}: {line.strip()}")
        for name in re.findall(r"secrets\.([A-Za-z0-9_]+)", line):
            if name not in ALLOWED_SECRETS:
                problems.append(f"secret {name} is not one this workflow may read: {line.strip()}")
        if "CLOUDFLARE_API_TOKEN" in line and line.strip() != TOKEN_LINE:
            problems.append(f"CLOUDFLARE_API_TOKEN may only be set from the site deploy token: {line.strip()}")
        if "AWARDWATCH_CHECK_KEY" in line and line.strip() != CHECK_KEY_LINE:
            problems.append(f"AWARDWATCH_CHECK_KEY may only be set from its own secret: {line.strip()}")
        used = re.match(r"\s*(?:-\s+)?uses:\s*(\S+)", line)
        if used and used.group(1) not in ALLOWED_ACTIONS:
            problems.append(f"action {used.group(1)} is not allowed")
        if "wrangler" in line.lower() and line.strip() != WRANGLER_ENV:
            calls = wrangler_calls(line)
            if not calls:
                problems.append(f"a Wrangler call not through the pinned $WRANGLER: {line.strip()}")
            for call in calls:
                if not any(form.match(call) for form in ALLOWED_WRANGLER.values()):
                    problems.append(f"a Wrangler command outside the allowed forms: {call.strip()}")
        for sub in re.findall(r"awardwatch_pipeline\.nightly\s+(\S+)", line):
            if sub not in ALLOWED_NIGHTLY:
                problems.append(f"nightly command {sub} is not allowed")
        if PART_BINDING.search(line) and line.strip() != PART_LOOP:
            problems.append(f"part may only come from the manifest through the name check: {line.strip()}")
        if ARGUMENT_BINDING.search(line) and line.strip() not in ARGUMENT_LINES and line.strip() not in (BRANDFETCH_ENV, MAIL_TEST_TO_ENV):
            problems.append(f"the deploy's arguments may only carry the Brandfetch client id and the test inbox: {line.strip()}")
    if sum(1 for line in lines if line.strip() == WRANGLER_ENV) != 1:
        problems.append("WRANGLER must be defined once, as the site's pinned binary")
    # The key in one line of the whole file (a job's or the workflow's env: would hand it to npm ci and every step),
    # and that line in the smoke step, whose command is the smoke test against the site's address and nothing else.
    steps = re.split(r"\n      - ", text.split("\n    steps:\n", 1)[1]) if "\n    steps:\n" in text else []
    keyed = [step for step in steps if "AWARDWATCH_CHECK_KEY" in step]
    if sum(1 for line in lines if "AWARDWATCH_CHECK_KEY" in line) != 1 or len(keyed) != 1 \
            or not re.search(r"^        id: smoke$", keyed[0], re.M):
        problems.append("AWARDWATCH_CHECK_KEY must reach the smoke step and no other")
    # The run block's lines (indented under it; the next step's comments follow at the step's indent).
    elif [ln.strip() for ln in keyed[0].split("        run: |\n", 1)[-1].splitlines()
          if ln.startswith(" " * 10) and ln.strip()] != [SMOKE_RUN]:
        problems.append("the smoke step must run the smoke test against $SITE and nothing else")
    if [line.strip() for line in lines if line.strip().startswith("SITE:")] != [SITE_ENV]:
        problems.append("SITE must be the repository variable or the site's own address, defined once")
    if [line.strip() for line in lines if line.strip().startswith("BUCKET:")] != ["BUCKET: awardwatch-data"]:
        problems.append("BUCKET must be awardwatch-data, defined once")
    return problems


def test_the_site_deploy_workflow_cannot_write_data():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert workflow_problems(text, NIGHTLY.read_text(encoding="utf-8")) == []


def test_the_workflow_uses_every_allowed_wrangler_form_and_the_four_helpers():
    text = WORKFLOW.read_text(encoding="utf-8")
    calls = [call for line in code_lines(text) for call in wrangler_calls(line)]
    found = {name for call in calls for name, form in ALLOWED_WRANGLER.items() if form.match(call)}
    assert found == set(ALLOWED_WRANGLER)
    assert len(calls) == 6  # manifest get, part get, status before, deploy, rollback, status after
    # The parts are named only by the checked loop, which the workflow has once.
    assert [line.strip() for line in code_lines(text) if PART_BINDING.search(line)] == [PART_LOOP]
    # The deploy's arguments: the client id from the repository variable, the test inbox from the secret, or nothing.
    assert [line.strip() for line in code_lines(text) if ARGUMENT_BINDING.search(line)] == [BRANDFETCH_ENV, MAIL_TEST_TO_ENV, *ARGUMENT_LINES]
    subs = set(re.findall(r"awardwatch_pipeline\.nightly\s+(\S+)", text))
    assert subs == ALLOWED_NIGHTLY
    # The parts are joined into the archive the unpack step reads.
    assert 'nightly join --dir "$WORK" --base static.tar.gz --out "$WORK/static.tar.gz"' in text


def test_the_deploy_token_reaches_only_the_steps_that_call_wrangler():
    text = WORKFLOW.read_text(encoding="utf-8")
    steps = re.split(r"\n      - ", text.split("\n    steps:\n", 1)[1])
    for step in steps:
        has_token = TOKEN_LINE in step
        calls_wrangler = '"$WRANGLER"' in step
        assert has_token == calls_wrangler, step.splitlines()[0]
    # The job's own environment carries no token, so npm ci and pip never see it.
    job_env = text.split("\n    env:\n", 1)[1].split("\n    steps:\n", 1)[0]
    assert "CLOUDFLARE_API_TOKEN" not in job_env


def test_the_workflow_text_has_no_em_dashes():
    assert "\u2014" not in WORKFLOW.read_text(encoding="utf-8")


PLANTED = [
    ("a push trigger", "on:\n  workflow_dispatch:", "on:\n  push:\n  workflow_dispatch:"),
    ("a schedule", "on:\n  workflow_dispatch:", "on:\n  schedule:\n    - cron: \"0 3 * * *\"\n  workflow_dispatch:"),
    ("write permission", "  contents: read", "  contents: write"),
    ("another group", "  group: nightly", "  group: site"),
    ("an R2 upload", '          ls -l "$WORK/static.tar.gz"',
     '          "$WRANGLER" r2 object put --remote "$BUCKET/static.tar.gz" --file "$WORK/static.tar.gz"'),
    ("a part upload", 'r2 object get --remote "$BUCKET/$part"', 'r2 object put --remote "$BUCKET/$part"'),
    ("a manifest read without --remote", 'r2 object get --remote "$BUCKET/static.tar.gz.parts"',
     'r2 object get "$BUCKET/static.tar.gz.parts"'),
    ("a part read outside the work folder", '--file "$WORK/$part"', '--file "site/public/data/$part"'),
    ("a part name without the check", PART_LOOP,
     "for part in $(awk '{print $2}' \"$WORK/static.tar.gz.parts\"); do"),
    ("a part name set by hand", '          if [ -z "$got" ]; then exit 1; fi',
     '          if [ -z "$got" ]; then exit 1; fi; part=../../site/public/data/x'),
    ("an R2 delete through npx", "        run: npm ci", "        run: npx wrangler r2 object delete --remote awardwatch-data/status.json"),
    ("a D1 command", '          ls -l "$WORK/static.tar.gz"',
     '          "$WRANGLER" d1 execute award-watch --remote --command "DELETE FROM corrections"'),
    ("a second command on a line", '            if "$WRANGLER" deploy "$@"; then exit 0; fi',
     '            if "$WRANGLER" deploy "$@"; then "$WRANGLER" r2 bucket delete awardwatch-data; fi'),
    ("deploy flags", '            if "$WRANGLER" deploy "$@"; then exit 0; fi', '            if "$WRANGLER" deploy --assets ../other; then exit 0; fi'),
    ("deploy flags through the arguments", 'set -- --var "BRANDFETCH_CLIENT_ID:$BRANDFETCH_CLIENT_ID"; fi',
     'set -- --var "BRANDFETCH_CLIENT_ID:$BRANDFETCH_CLIENT_ID" --assets ../other; fi'),
    ("arguments set elsewhere", "          for attempt in 1 2 3; do\n            if \"$WRANGLER\" deploy",
     "          set -- --dispatch-namespace x\n          for attempt in 1 2 3; do\n            if \"$WRANGLER\" deploy"),
    ("the client id from a secret", "BRANDFETCH_CLIENT_ID: ${{ vars.BRANDFETCH_CLIENT_ID }}",
     "BRANDFETCH_CLIENT_ID: ${{ secrets.CLOUDFLARE_API_TOKEN }}"),
    ("the test inbox from a variable, unmasked in the log", MAIL_TEST_TO_ENV, "MAIL_TEST_TO: ${{ vars.MAIL_TEST_TO }}"),
    ("the test inbox from another secret", MAIL_TEST_TO_ENV, "MAIL_TEST_TO: ${{ secrets.CLOUDFLARE_SITE_DEPLOY_TOKEN }}"),
    ("deploy flags through the test inbox", 'set -- "$@" --var "MAIL_TEST_TO:$MAIL_TEST_TO"; fi',
     'set -- "$@" --var "MAIL_TEST_TO:$MAIL_TEST_TO" --assets ../other; fi'),
    ("the nightly's token", TOKEN_LINE, "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"),
    ("the check key from a variable", CHECK_KEY_LINE, "AWARDWATCH_CHECK_KEY: ${{ vars.AWARDWATCH_CHECK_KEY }}"),
    ("the check key from another secret", CHECK_KEY_LINE, "AWARDWATCH_CHECK_KEY: ${{ secrets.CLOUDFLARE_SITE_DEPLOY_TOKEN }}"),
    ("the check key in another step too", "        run: npm run test:mail\n",
     "        env:\n          AWARDWATCH_CHECK_KEY: ${{ secrets.AWARDWATCH_CHECK_KEY }}\n        run: npm run test:mail\n"),
    ("the check key moved off the smoke step", "        env:\n          AWARDWATCH_CHECK_KEY: ${{ secrets.AWARDWATCH_CHECK_KEY }}\n", ""),
    ("the check key in the job's env as well", f"      {SITE_ENV}\n", f"      {SITE_ENV}\n      {CHECK_KEY_LINE}\n"),
    ("the check key in the workflow's env as well", "\njobs:\n", f"\nenv:\n  {CHECK_KEY_LINE}\n\njobs:\n"),
    ("the smoke command replaced", SMOKE_RUN, "true"),
    ("the smoke command sent elsewhere", SMOKE_RUN, SMOKE_RUN.replace('"$SITE"', "https://elsewhere.example")),
    ("a second command in the smoke step", SMOKE_RUN, SMOKE_RUN + "\n          env | sort"),
    ("the site's address changed", SITE_ENV, "SITE: https://elsewhere.example"),
    ("a state-writing nightly command", "--out \"$WORK/version_before.txt\"",
     "--out \"$WORK/version_before.txt\"; python -m awardwatch_pipeline.nightly status --db x --out y"),
    ("another nightly command", "awardwatch_pipeline.nightly join --dir", "awardwatch_pipeline.nightly split --dir"),
    ("the pipeline run", "        run: pip install -e ./pipeline",
     "        run: pip install -e ./pipeline && python -m awardwatch_pipeline run --db data/awardwatch.sqlite"),
    ("a commit", "          test -s \"$WORK/stats.before.json\"", "          git commit -am x && git push"),
    ("a direct API call", "          test -s \"$WORK/stats.before.json\"",
     "          curl -X PUT https://api.cloudflare.com/client/v4/accounts/x/r2/buckets/awardwatch-data/objects/x"),
    ("another secret", "REASON: ${{ inputs.reason }}", "REASON: ${{ secrets.GSC_SERVICE_ACCOUNT_JSON }}"),
    ("another action", "      - uses: actions/checkout@v4", "      - uses: ./.github/workflows/nightly.yml"),
    ("a check removed", "      - name: The mail suite\n        id: mail_suite\n        working-directory: site\n"
                        "        run: npm run test:mail\n", ""),
    ("a check allowed to fail", "        id: worker_suite\n", "        id: worker_suite\n        continue-on-error: true\n"),
    ("a check behind a condition", "        id: typecheck\n", "        id: typecheck\n        if: ${{ always() }}\n"),
    ("a check whose failure is swallowed", "        run: npm test\n", "        run: npm test || true\n"),
    ("a check on a run block", "        run: npm run typecheck\n", "        run: |\n          npm run typecheck\n"),
    ("another npm script", "        run: npm run test:mail\n", "        run: npm run deploy\n"),
    ("the tag dropped", 'set -- "$@" --tag "${commit:0:12}" --message "commit $commit"',
     'set -- "$@" --message "commit $commit"'),
    ("the commit from the dispatcher", "commit=$(git rev-parse HEAD)", 'commit="$REASON"'),
    ("another git command", "commit=$(git rev-parse HEAD)", "commit=$(git rev-parse HEAD); git fetch origin"),
]


@pytest.mark.parametrize("label, old, new", PLANTED, ids=[p[0] for p in PLANTED])
def test_the_guard_catches_a_planted_change(label, old, new):
    text = WORKFLOW.read_text(encoding="utf-8")
    assert old in text, f"the anchor for {label} is gone from the workflow"
    assert workflow_problems(text.replace(old, new, 1)) != []


def test_the_checks_run_before_the_bundle_and_never_after_the_deploy():
    text = WORKFLOW.read_text(encoding="utf-8")
    steps = job_steps(text)
    names = [s[0] for s in steps]
    runs = [next((line for line in s if line.startswith("run: ")), "") for s in steps]
    at = [runs.index(f"run: {run}") for run in SUITE_RUNS]
    assert runs.index("run: npm ci") < at[0] < at[1] < at[2] < names.index("- name: Download the static bundle from R2")
    assert names.index("- name: Download the static bundle from R2") < names.index("- name: Record the live Worker version") \
        < names.index("- name: Deploy the Worker")
    # The three checks moved after the deploy, whole: the guard sees it.
    block = text.split("      # The site's checks, as package.json names them", 1)[1].split("\n\n", 1)[0]
    block = "      # The site's checks, as package.json names them" + block + "\n"
    assert block.count("        run: npm") == 3
    moved = text.replace(block, "", 1).replace("      # The nightly's smoke test:", block + "      # The nightly's smoke test:", 1)
    assert moved != text
    assert [p for p in workflow_problems(moved) if "must run after npm ci and before the bundle download" in p] != []


def test_the_summary_says_why_the_deploy_did_not_run():
    text = WORKFLOW.read_text(encoding="utf-8")
    summary = text.split("- name: Summary and verdict", 1)[1]
    # The three outcomes reach the summary through its environment, and its Tests row names the checks that failed.
    for env, step_id in (("TYPECHECK", "typecheck"), ("WORKER_SUITE", "worker_suite"), ("MAIL_SUITE", "mail_suite")):
        assert f"{env}: ${{{{ steps.{step_id}.outcome }}}}" in summary
        assert f"id: {step_id}\n" in text
    assert 'echo "| Tests | $tests |"' in summary
    assert 'deploy="not run (the tests failed: $failed_checks)"' in summary
    # A run stopped by a check never records a version, so neither the rollback nor the last read runs.
    rollback = text.split("- name: Roll the Worker back when the deploy did not hold", 1)[1].split("\n      - ", 1)[0]
    after = text.split("- name: Read the version now live", 1)[1].split("\n      - ", 1)[0]
    assert "steps.version.outputs.version_id != ''" in rollback and "steps.version.outputs.version_id != ''" in after
    assert "steps.deploy.outcome != 'skipped'" in after


def test_the_deploy_names_the_commit_it_ships_in_both_workflows():
    for path in (WORKFLOW, NIGHTLY):
        deploy = [line.strip() for line in code_lines(path.read_text(encoding="utf-8"))]
        at = deploy.index("commit=$(git rev-parse HEAD)")
        assert deploy[at + 1] == ARGUMENT_LINES[-1], path.name
        # Added to the arguments after the two --var lines and before the three tries, which reuse them.
        assert deploy[at - 1] == ARGUMENT_LINES[2] and deploy[at + 2] == "for attempt in 1 2 3; do", path.name
