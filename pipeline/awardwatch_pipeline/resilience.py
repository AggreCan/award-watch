"""The parts of the nightly workflow that let a failed night heal by itself.

nightly.py calls these from its command line; the workflow calls nightly.py.

  gate          decide whether a gated trigger (any schedule of GitHub's, or
                the Worker's dispatch) has anything to do, from the time and
                the status.json the last run left in R2.
  live_version  the Worker version serving traffic, from Wrangler's JSON, so
                a deploy that breaks the site can be rolled back to it.
  live_commit   the commit a Worker version was deployed from, from the
                annotations every deploy writes (--tag, --message), so a
                night whose tests fail on main can run the commit that is live.
  smoke         fetch a few pages of the live site after a deploy and judge
                it ok, broken (the Worker answers 5xx) or unverifiable (the
                edge refused the runner, or the answer proves nothing).
  bundle_check  for the site-only deploy: compare the data files of the
                static bundle saved in R2 (static.tar.gz, in parts) with the
                ones the live site serves.
  R2Rest        list the bucket and download one object through Cloudflare's
                REST API, for the weekly snapshot the restore falls back to;
                list a prefix whole and remove one object, for the prune of
                old download files (nightly prune-downloads).
  run_checks    once a month, the expiry dates of the tokens and the domain.
  attention_items, issue_texts
                the items the run's last step reports, and the text of the
                GitHub issue it opens, updates or closes.
  notice_items  the run's notices: information for LAST_RUN.md and the
                daily check's email, never an item needing attention.

Every function here returns its finding rather than raising: a fault in this
layer must never stop a night that would otherwise have worked. Tokens travel
only in Authorization headers and are scrubbed from any message, so no log
line, file or issue can carry one.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, time as clock_time, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import quote, urlencode, urlsplit

from . import config

log = logging.getLogger("awardwatch_pipeline.resilience")

API = "https://api.cloudflare.com/client/v4"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _parse_iso(text: Any) -> datetime | None:
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        when = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def _status_code(resp: Any) -> int:
    try:
        return int(getattr(resp, "status_code", 0) or 0)
    except (TypeError, ValueError):
        return 0


def _scrub(text: str, *secrets: str | None) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[token]")
    return text


def _api_errors(resp: Any) -> str:
    """Cloudflare's own error codes and messages, short; never the request."""
    try:
        errors = resp.json().get("errors") or []
        parts = [f"{e.get('code')} {e.get('message')}" for e in errors if isinstance(e, dict)]
    except Exception:
        return ""
    return f" ({'; '.join(parts)[:160]})" if parts else ""


def _api_codes(resp: Any) -> set[int]:
    try:
        return {int(e.get("code")) for e in resp.json().get("errors") or [] if isinstance(e, dict)}
    except Exception:
        return set()


# -- gate ---------------------------------------------------------------------


# The nightly's day opens at 12:00 UTC, half an hour before its first slot
# (12:30): CanadaBuys has regenerated the morning's files by then. A trigger
# before it is a late one from the day before, and a run that started before
# it read the files of the day before.
DAY_OPENS = clock_time(12, 0)


def gate(status: Any, now: datetime) -> tuple[bool, str]:
    """(skip, reason) for a gated trigger: every schedule of GitHub's and every
    dispatch with the input gate "true" (the Worker's own cron). now is the
    runner's clock, never text from the event.

    Before 12:00 UTC: skip, nothing is due. Otherwise skip only when the
    status shows a run that started at or after 12:00 UTC today (by
    run_started; a status written before that field existed is read by its
    end, run_at) and finished clean and deployed. Anything else, a missing or
    unreadable status included, runs the refresh. A second refresh on the
    same day costs only a conditional request per source file: the files
    that did not change since the first are not downloaded again."""
    now = now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    opens = datetime.combine(now.date(), DAY_OPENS, tzinfo=timezone.utc)
    if now < opens:
        return True, (f"it is {now:%H:%M} UTC, before {DAY_OPENS:%H:%M}: nothing is due before the day's first slot, "
                      f"so this trigger is a late one from the day before; nothing to do")
    if not isinstance(status, dict):
        return False, "no readable run status, so the refresh runs"
    when, which = _parse_iso(status.get("run_started")), "started"
    if when is None:
        when, which = _parse_iso(status.get("run_at")), "finished"
    if when is None:
        return False, "the run status has no readable run time, so the refresh runs"
    when = when.astimezone(timezone.utc)
    if not opens <= when < opens + timedelta(hours=12):
        return False, (f"the last run {which} at {when:%Y-%m-%d %H:%M} UTC, not at or after {DAY_OPENS:%H:%M} UTC "
                       f"today ({now.date()}), so the refresh runs")
    if status.get("ok") is not True:
        return False, "today's run did not finish clean, so the refresh runs again"
    steps = status.get("steps")
    if not isinstance(steps, dict) or steps.get("deploy") != "success":
        return False, "today's run did not deploy, so the refresh runs again"
    began = f"started at {when:%H:%M} UTC and " if which == "started" else ""
    return True, f"today's run {began}finished clean at {status.get('run_at')}; nothing to do"


# -- the live version ---------------------------------------------------------


def _first_json(text: str) -> Any:
    """The first JSON value in text. Wrangler may print a notice before it."""
    decoder = json.JSONDecoder()
    start = 0
    while True:
        found = [i for i in (text.find("{", start), text.find("[", start)) if i >= 0]
        if not found:
            raise ValueError("no JSON in the output")
        i = min(found)
        try:
            return decoder.raw_decode(text, i)[0]
        except ValueError:
            start = i + 1


def _largest_share(versions: list[Any]) -> str | None:
    best: tuple[float, str] | None = None
    for v in versions:
        if not isinstance(v, dict):
            continue
        vid, share = v.get("version_id"), v.get("percentage")
        if not isinstance(vid, str) or not UUID_RE.match(vid):
            continue
        try:
            pct = float(share)
        except (TypeError, ValueError):
            continue
        if best is None or pct > best[0]:
            best = (pct, vid)
    return best[1] if best else None


def live_version(text: str) -> str | None:
    """The Worker version serving traffic, or None.

    Reads `wrangler deployments status --json` (one deployment: the version
    with the largest share of traffic), and also the lists that
    `wrangler deployments list --json` and `wrangler versions list --json`
    print (the newest by created_on). The workflow uses deployments status:
    versions list returns every deployable version, and one uploaded without
    being deployed would be newer than the one serving traffic. Only a
    well-formed version id is returned, so the value is safe on a command line.
    """
    try:
        data = _first_json(text or "")
    except ValueError:
        return None
    if isinstance(data, dict) and isinstance(data.get("versions"), list):
        return _largest_share(data["versions"])
    if not isinstance(data, list):
        return None
    dated: list[tuple[datetime, str]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("versions"), list):
            vid, stamp = _largest_share(item["versions"]), item.get("created_on")
        else:
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            vid, stamp = item.get("id"), meta.get("created_on")
        when = _parse_iso(stamp)
        if isinstance(vid, str) and UUID_RE.match(vid) and when is not None:
            dated.append((when, vid))
    return max(dated)[1] if dated else None


# -- the commit a version was deployed from -----------------------------------

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
# What the deploys write (deploy-site.yml and the nightly's deploy step): the
# version's message is "commit <the full commit>" and its tag the commit's
# first 12 characters.
COMMIT_MESSAGE_RE = re.compile(r"^commit ([0-9a-f]{40})$")
COMMIT_TAG_LEN = 12


def live_commit(text: str) -> str | None:
    """The 40-character commit a Worker version was deployed from, or None.

    Reads `wrangler versions view <id> --json`: the version's annotations,
    workers/message "commit <commit>" first, else a workers/tag that is a
    whole commit. A tag beside the message must be the commit's start; a
    message or tag of any other form, a tag too short to name a commit, and
    the output of `deployments status` (whose annotations describe the
    deployment, which a rollback also makes, never the code) give None, so
    a commit is returned only when the version itself names it."""
    try:
        data = _first_json(text or "")
    except ValueError:
        return None
    if not isinstance(data, dict) or "versions" in data:
        return None
    annotations = data.get("annotations")
    if not isinstance(annotations, dict):
        return None
    message, tag = annotations.get("workers/message"), annotations.get("workers/tag")
    commit = None
    if isinstance(message, str):
        found = COMMIT_MESSAGE_RE.fullmatch(message)
        commit = found.group(1) if found else None
    if commit is None and isinstance(tag, str) and COMMIT_RE.fullmatch(tag):
        commit = tag
    if commit is not None and tag is not None and not (isinstance(tag, str) and tag and commit.startswith(tag)):
        return None
    return commit


# -- smoke test ---------------------------------------------------------------

# "/overview" is the day's overview every reader gets (the home page before
# the landing page took "/" for a reader without a session): the one page
# that reads the counts, the map and the day's lists together.
SMOKE_PAGES = ("/", "/overview", "/tenders", "/data")
# Pages that print the data date (the layout's "Data as of"; on "/", which a
# check without a session gets as the landing page, its figures' "Counted on"
# line); the deploy carried tonight's export only if they show it.
DATED_PAGES = {"/", "/overview", "/data"}
SMOKE_RETRY_S = 30.0
# A new version reaches every edge location within seconds of the deploy.
SMOKE_SETTLE_S = 20.0
SMOKE_TIMEOUT_S = 30.0
ORG_ID_RE = re.compile(r"^org-[0-9a-f]{10}$")
# Text of Cloudflare's challenge and block pages. The edge answers a challenge
# with 403 or, in Under Attack Mode, 503; neither says anything about the Worker.
CHALLENGE_MARKERS = ("cf-chl", "challenge-platform", "just a moment...", "attention required! | cloudflare",
                     "cf-error-details", "sorry, you have been blocked")
MAX_BODY = 2_000_000
# The zone's custom rule challenges a client that is not a verified crawler on the data pages (/overview, /tenders, a
# profile among the smoke pages), and a runner's network changes from night to night (2026-11-26: three of the five
# pages answered with a challenge). The smoke test sends this header with the key from CHECK_KEY_ENV, which the rule
# lets through; without a key it sends no header. The key comes from the repository secret of the same name, reaches
# the smoke step only, and is never logged or written.
CHECK_HEADER = "X-AwardWatch-Check"
CHECK_KEY_ENV = "AWARDWATCH_CHECK_KEY"
CHECK_KEY_RE = re.compile(r"^[0-9a-f]{64}$")
# The only place the key is sent: https on the site's own host, and never past a redirect (requests carries a custom
# header to wherever a redirect leads). A base URL anywhere else gets no header, and its covered pages are challenged.
CHECK_HOSTS = ("awardwatch.ca",)


def keyed_url(url: str) -> bool:
    """Whether a request to url may carry the check key."""
    parts = urlsplit(url)
    return parts.scheme == "https" and (parts.hostname or "") in CHECK_HOSTS and parts.port is None

VERDICTS = ("ok", "broken", "unverifiable")


@dataclass
class Attempt:
    status: int  # 0 when no answer came
    kind: str  # ok, server, edge, stale, other
    note: str


@dataclass
class PageResult:
    path: str
    attempts: list[Attempt] = field(default_factory=list)

    @property
    def final(self) -> Attempt:
        return self.attempts[-1]

    def as_dict(self) -> dict[str, Any]:
        return {"path": self.path, "attempts": [{"status": a.status, "kind": a.kind, "note": a.note} for a in self.attempts]}


def _challenge(resp: Any, body: str) -> bool:
    try:
        headers = {str(k).lower(): str(v).lower() for k, v in (getattr(resp, "headers", None) or {}).items()}
    except Exception:
        headers = {}
    if headers.get("cf-mitigated") == "challenge":
        return True
    low = body[:20_000].lower()
    return any(m in low for m in CHALLENGE_MARKERS)


def judge_answer(path: str, status: int, body: str, challenge: bool, data_date: str | None) -> Attempt:
    """One answer, classified."""
    if challenge or status == 403:
        return Attempt(status, "edge", f"{path}: {status} from the edge (the runner may be blocked by the dashboard's rules)")
    if 500 <= status <= 599:
        return Attempt(status, "server", f"{path}: {status}")
    if status != 200:
        return Attempt(status, "other", f"{path}: {status or 'no answer'}")
    if path in DATED_PAGES:
        if not data_date:
            return Attempt(status, "stale", f"{path}: 200, but no data date was given to look for")
        if data_date not in body:
            return Attempt(status, "stale", f"{path}: 200 without the data date {data_date}")
    return Attempt(status, "ok", f"{path}: 200")


def check_key(env: Mapping[str, str] | None = None) -> str | None:
    """The key the smoke test sends (CHECK_KEY_ENV): 64 lower-case hex characters, else None."""
    value = str((os.environ if env is None else env).get(CHECK_KEY_ENV) or "").strip()
    return value if CHECK_KEY_RE.match(value) else None


def fetch(http: Any, base_url: str, path: str, data_date: str | None, timeout: float = SMOKE_TIMEOUT_S, *,
          key: str | None = None) -> Attempt:
    url = base_url.rstrip("/") + path
    headers = {"User-Agent": config.USER_AGENT, "Cache-Control": "no-cache"}
    extra: dict[str, Any] = {}
    if key is not None and keyed_url(url):
        headers[CHECK_HEADER] = key
        # A redirect is answered as it stands (no page here redirects); it never takes the key elsewhere.
        extra["allow_redirects"] = False
    try:
        resp = http.get(url, headers=headers, timeout=timeout, **extra)
    except Exception as exc:
        return Attempt(0, "other", f"{path}: no answer ({type(exc).__name__})")
    status = _status_code(resp)
    try:
        body = str(resp.text)[:MAX_BODY]
    except Exception:
        body = ""
    return judge_answer(path, status, body, _challenge(resp, body), data_date)


def smoke_paths(stats: Any) -> list[str]:
    """The pages to fetch: home, open tenders, data, and the profile of the
    first organization in the year's top list when stats.json names a
    well-formed id (a profile reads a shard, the path most likely to break)."""
    paths = list(SMOKE_PAGES)
    rows = stats.get("top_organizations_year") if isinstance(stats, dict) else None
    for row in rows if isinstance(rows, list) else []:
        oid = row.get("id") if isinstance(row, dict) else None
        if isinstance(oid, str) and ORG_ID_RE.match(oid):
            paths.append(f"/organizations/{oid}")
            break
    return paths


def judge(results: list[PageResult]) -> tuple[str, str]:
    """(verdict, detail). broken: some page answered 5xx on both tries. ok:
    every page's last answer was 200 (with the data date where it is
    printed). unverifiable: anything else, the edge refusing the runner
    included, which is never a reason to roll back."""
    broken = [r for r in results if len(r.attempts) >= 2 and all(a.kind == "server" for a in r.attempts[:2])]
    if broken:
        return "broken", "; ".join(f"{r.path} answered {r.attempts[0].status} and {r.attempts[1].status}" for r in broken)
    if results and all(r.final.kind == "ok" for r in results):
        return "ok", f"{len(results)} pages answered 200"
    if not results:
        return "unverifiable", "no page was fetched"
    return "unverifiable", "; ".join(r.final.note for r in results if r.final.kind != "ok")[:400]


def smoke(http: Any, base_url: str, data_date: str | None, paths: list[str], *,
          sleep: Callable[[float], None] = time.sleep, settle: float = SMOKE_SETTLE_S,
          retry_after: float = SMOKE_RETRY_S, key: str | None = None) -> dict[str, Any]:
    """Fetch every page, then once more after retry_after seconds each page
    whose first answer was not ok, and judge. Never raises. key is sent as
    CHECK_HEADER with every request to the site's own host (keyed_url); the
    result says only whether one was."""
    try:
        if settle:
            sleep(settle)
        results = [PageResult(p, [fetch(http, base_url, p, data_date, key=key)]) for p in paths]
        again = [r for r in results if r.final.kind != "ok"]
        if again:
            sleep(retry_after)
            for r in again:
                r.attempts.append(fetch(http, base_url, r.path, data_date, key=key))
        verdict, detail = judge(results)
        pages = [r.as_dict() for r in results]
    except Exception as exc:
        verdict, detail, pages = "unverifiable", f"the check itself failed ({type(exc).__name__})", []
    return {"verdict": verdict, "detail": detail, "base_url": base_url, "data_date": data_date,
            "keyed": key is not None and keyed_url(base_url.rstrip("/") + "/"), "pages": pages}


# -- site bundle check --------------------------------------------------------

# The files the site-only deploy (.github/workflows/deploy-site.yml) compares
# between the static bundle saved in R2 (static.tar.gz, joined from its parts)
# and the live site. stats.json lists the newest runs with their times and
# changes with every refresh, so an archive from any other night fails; the
# open notices are the list the tender pages and the feeds are built from.
BUNDLE_FILES = ("stats.json", "tenders/open.json")
BUNDLE_RETRY_S = 10.0
# The Worker refuses an asset above 25 MiB, so nothing larger is one of its files.
MAX_BUNDLE_FILE = 25 * 1024 * 1024
SAVED_LABEL = "the copy saved before the deploy"


def _canonical(raw: bytes) -> str | None:
    """One text per JSON value, or None when raw is not JSON. Key order and
    spacing do not count; a change of type does (true is not 1, 1 is not 1.0)."""
    try:
        return json.dumps(json.loads(raw), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except (ValueError, TypeError, RecursionError):
        return None


def _archive_file(bundle: Path, rel: str) -> tuple[bytes | None, str]:
    path = bundle / rel
    try:
        if not path.is_file():
            return None, f"{rel}: not in the archive"
        if path.stat().st_size > MAX_BUNDLE_FILE:
            return None, f"{rel}: the archive's copy is larger than any asset the site can serve"
        return path.read_bytes(), ""
    except OSError as exc:
        return None, f"{rel}: the archive's copy could not be read ({type(exc).__name__})"


def _fetch_bytes(http: Any, url: str, timeout: float) -> tuple[bytes | None, str]:
    try:
        resp = http.get(url, headers={"User-Agent": config.USER_AGENT, "Cache-Control": "no-cache"}, timeout=timeout)
    except Exception as exc:
        return None, f"no answer ({type(exc).__name__})"
    status = _status_code(resp)
    if status != 200:
        return None, f"answered {status or 'nothing'}"
    try:
        body = bytes(resp.content)
    except Exception:
        return None, "answered 200 without a readable body"
    if len(body) > MAX_BUNDLE_FILE:
        return None, "answered with more than any asset can hold"
    return body, ""


def _compare(rel: str, against: str, archive: bytes, other: bytes | None, why: str) -> dict[str, str]:
    entry = {"file": rel, "against": against}
    if other is None:
        return entry | {"result": "unreachable", "note": f"{rel}: {against} {why}"}
    mine, theirs = _canonical(archive), _canonical(other)
    if mine is None:
        return entry | {"result": "unreadable", "note": f"{rel}: the archive's copy is not JSON"}
    if theirs is None:
        return entry | {"result": "unreadable", "note": f"{rel}: {against} is not JSON"}
    if mine != theirs:
        return entry | {"result": "differs", "note": f"{rel}: the archive and {against} differ"}
    return entry | {"result": "same", "note": f"{rel}: the same as {against}"}


def bundle_check(http: Any, base_url: str, bundle: Path, saved_stats: Path | None = None, *,
                 sleep: Callable[[float], None] = time.sleep, retry_after: float = BUNDLE_RETRY_S,
                 timeout: float = SMOKE_TIMEOUT_S) -> tuple[dict[str, Any], bytes | None]:
    """Compare the unpacked archive's BUNDLE_FILES with the ones the live site
    serves under /data/, as parsed JSON, and, when saved_stats is given, the
    archive's stats.json with that file as well. A file the site does not
    answer 200 for is fetched once more after retry_after seconds.

    Returns (record, live stats.json bytes). record["ok"] is true only when
    every comparison found the same value; a file missing from the archive,
    an answer other than 200, or a body that is not JSON is never ok. Never
    raises."""
    base = base_url.rstrip("/")
    files: list[dict[str, str]] = []
    live_stats: bytes | None = None
    try:
        for rel in BUNDLE_FILES:
            url = f"{base}/data/{rel}"
            archive, note = _archive_file(bundle, rel)
            if archive is None:
                files.append({"file": rel, "against": url, "result": "missing", "note": note})
                continue
            body, why = _fetch_bytes(http, url, timeout)
            if body is None:
                sleep(retry_after)
                body, why = _fetch_bytes(http, url, timeout)
            if rel == "stats.json":
                live_stats = body
            files.append(_compare(rel, url, archive, body, why))
        if saved_stats is not None:
            archive, note = _archive_file(bundle, "stats.json")
            if archive is None:
                files.append({"file": "stats.json", "against": SAVED_LABEL, "result": "missing", "note": note})
            else:
                try:
                    saved, why = saved_stats.read_bytes(), ""
                except OSError as exc:
                    saved, why = None, f"could not be read ({type(exc).__name__})"
                files.append(_compare("stats.json", SAVED_LABEL, archive, saved, why))
    except Exception as exc:
        files.append({"file": "(all)", "against": base, "result": "error",
                      "note": f"the check itself failed ({type(exc).__name__})"})
    ok = bool(files) and all(f["result"] == "same" for f in files)
    return {"ok": ok, "base_url": base_url, "files": files}, live_stats


# -- R2 through the REST API --------------------------------------------------

DATA_BUCKET = "awardwatch-data"
WEEKLY_PREFIX = "backups/weekly/db-slot-"
# A weekly snapshot is a set of parts named by its manifest
# (db-slot-N.sqlite.gz.parts, uploaded after its parts, so its time is the
# set's), or a single file from before the backups were split.
WEEKLY_RE = re.compile(r"^backups/weekly/db-slot-\d+\.sqlite\.gz(?:\.parts)?$")
# A listing of the weekly folder is a handful of objects; the cap only bounds
# a cursor that never ends.
MAX_LIST_PAGES = 20


class R2Error(Exception):
    """R2 did not answer as expected. The message never carries the token."""


# The one shape of key this code may ever remove from the bucket
# (R2Rest.delete_download): a yearly CSV file directly under downloads/. It is
# written out here, apart from nightly.YEARLY_DOWNLOAD_RE, which chooses the
# files, so a mistake in the choice is not a mistake in the removal (a test
# holds the two to the same names).
DELETABLE_KEY_RE = re.compile(
    r"^downloads/(?:awards|history|contracts|grants)-(?:[0-9]{4}|before-[0-9]{4}|after-[0-9]{4}|undated)(?:-[2-9])?\.csv$")
# What no removable key holds: the names of the database and of its backups,
# the bucket's other prefixes, and anything that could climb out of
# downloads/ or be read another way by the API. Checked apart from the
# pattern above, on the key in lower case.
PROTECTED_MARKS = ("sqlite", "backup", ".gz", ".parts", ".sql", ".tar", ".json", ".txt", ".zip", "static", "status",
                   "views/", "seeds/", "review/", "intraday/", "mirror/", "weekly", "slot", "prev",
                   "..", "//", "%", "\\", "?", "#", "&", " ", "\t", "\n", "\r", "\x00")


def removal_refusal(key: Any) -> str | None:
    """Why the object at key may not be removed, or None when it may: the
    removal's own check (R2Rest.delete_download), which trusts no caller."""
    if not isinstance(key, str) or not key:
        return "not a key"
    lowered = key.lower()
    for mark in PROTECTED_MARKS:
        if mark in lowered:
            return f"the key holds {mark!r}, which no download file's name does"
    if key.count("/") != 1 or not key.startswith("downloads/"):
        return "the key is not directly under downloads/"
    if not DELETABLE_KEY_RE.fullmatch(key):
        return "the key is not a yearly download file"
    return None


class R2Rest:
    """The R2 calls Wrangler has no command for: a listing, the download of an
    object found by it, and the removal of one stale download file (the prune
    of old download files, when nightly.PRUNE_MODE is "delete"). There is no
    general removal: delete_download is the only call that sends a DELETE,
    and it checks the key itself. Same token as the rest of the run
    (CLOUDFLARE_API_TOKEN, R2 edit on the project account)."""

    def __init__(self, http: Any, account: str, token: str, bucket: str, timeout: float = 120) -> None:
        self.http, self.account, self.token, self.bucket, self.timeout = http, account, token, bucket, timeout

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "User-Agent": config.USER_AGENT}

    def _base(self) -> str:
        return f"{API}/accounts/{quote(self.account, safe='')}/r2/buckets/{quote(self.bucket, safe='')}/objects"

    def _fail(self, what: str, exc: Exception | None = None, resp: Any = None) -> R2Error:
        if exc is not None:
            text = f"{what} failed ({type(exc).__name__}: {str(exc)[:120]})"
        else:
            text = f"{what} answered HTTP {_status_code(resp)}{_api_errors(resp)}"
        return R2Error(_scrub(text, self.token, self.account))

    def list(self, prefix: str, *, whole: bool = False) -> list[dict[str, Any]]:
        """Every object under prefix, page after page. With whole, an answer
        that says the listing goes on (is_truncated) but gives no cursor to
        continue it raises R2Error instead of ending the list there: the prune
        of old download files must see every object. The weekly restore keeps
        the reading it has."""
        objects: list[dict[str, Any]] = []
        cursor = None
        for _ in range(MAX_LIST_PAGES):
            # No prefix lists the whole bucket (the prune's inventory before and after a removal).
            params: dict[str, Any] = {"prefix": prefix, "per_page": 100} if prefix else {"per_page": 100}
            if cursor:
                params["cursor"] = cursor
            try:
                resp = self.http.get(f"{self._base()}?{urlencode(params)}", headers=self._headers(), timeout=self.timeout)
            except Exception as exc:
                raise self._fail("the listing", exc) from None
            if _status_code(resp) != 200:
                raise self._fail("the listing", resp=resp)
            try:
                payload = resp.json()
                result = payload.get("result")
            except Exception:
                raise R2Error("the listing answered without JSON") from None
            if isinstance(result, dict):
                result = result.get("objects")
            if not isinstance(result, list) or payload.get("success") is False:
                raise R2Error("the listing answered without a list of objects")
            objects.extend(o for o in result if isinstance(o, dict))
            info = payload.get("result_info") if isinstance(payload.get("result_info"), dict) else {}
            cursor = info.get("cursor") if info.get("is_truncated") else None
            if not cursor:
                if whole and info.get("is_truncated"):
                    raise R2Error("the listing was cut short and gave no cursor to continue it")
                return objects
        raise R2Error(f"the listing did not end after {MAX_LIST_PAGES} pages")

    def newest_weekly(self) -> tuple[str, str] | None:
        """(key, upload time) of the newest weekly database snapshot (its
        manifest, or the single file), or None when the bucket holds none.
        Raises R2Error when that cannot be known."""
        best: tuple[datetime, str, str] | None = None
        undated = 0
        for obj in self.list(WEEKLY_PREFIX):
            key = obj.get("key")
            if not isinstance(key, str) or not WEEKLY_RE.match(key):
                continue
            when = _parse_iso(obj.get("last_modified") or obj.get("uploaded"))
            if when is None:
                undated += 1
                continue
            if best is None or when > best[0]:
                best = (when, key, when.astimezone(timezone.utc).isoformat(timespec="seconds"))
        # Snapshots that cannot be ordered are not "no snapshot": reading
        # them as none would start a first run over a week of history.
        if best is None and undated:
            raise R2Error(f"the listing named {undated} snapshot(s) without an upload time")
        return (best[1], best[2]) if best else None

    def download(self, key: str, dest: Path) -> int:
        """Write the object to dest (through a partial file); its size in bytes."""
        url = f"{self._base()}/{quote(key, safe='/')}"
        partial = dest.with_name(dest.name + ".partial")
        try:
            resp = self.http.get(url, headers=self._headers(), timeout=self.timeout, stream=True)
        except Exception as exc:
            raise self._fail(f"the download of {key}", exc) from None
        if _status_code(resp) != 200:
            raise self._fail(f"the download of {key}", resp=resp)
        size = 0
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with partial.open("wb") as fh:
                for chunk in resp.iter_content(1 << 20):
                    if chunk:
                        fh.write(chunk)
                        size += len(chunk)
        except Exception as exc:
            partial.unlink(missing_ok=True)
            raise self._fail(f"the download of {key}", exc) from None
        finally:
            close = getattr(resp, "close", None)
            if callable(close):
                close()
        partial.replace(dest)
        return size

    def get_bytes(self, key: str, max_bytes: int = 32 << 20) -> bytes | None:
        """A small object's bytes, or None when the bucket holds no such key.

        Raises R2Error for anything else (a missing bucket included), so a read
        that failed is never taken for an object that does not exist."""
        url = f"{self._base()}/{quote(key, safe='/')}"
        try:
            resp = self.http.get(url, headers=self._headers(), timeout=self.timeout, stream=True)
        except Exception as exc:
            raise self._fail(f"the download of {key}", exc) from None
        try:
            status = _status_code(resp)
            # 10006 is "the bucket does not exist"; 10007 (or no code) is the key.
            if status == 404 and 10006 not in _api_codes(resp):
                return None
            if status != 200:
                raise self._fail(f"the download of {key}", resp=resp)
            parts: list[bytes] = []
            size = 0
            for chunk in resp.iter_content(1 << 16):
                if chunk:
                    parts.append(chunk)
                    size += len(chunk)
                    if size > max_bytes:
                        raise R2Error(f"{key} is larger than {max_bytes} bytes")
            return b"".join(parts)
        except R2Error:
            raise
        except Exception as exc:
            raise self._fail(f"the download of {key}", exc) from None
        finally:
            close = getattr(resp, "close", None)
            if callable(close):
                close()

    def upload(self, key: str, data: bytes, content_type: str) -> None:
        """Put one small object (the path Wrangler's own r2 object put takes)."""
        url = f"{self._base()}/{quote(key, safe='/')}"
        try:
            resp = self.http.put(url, data=data, headers={**self._headers(), "Content-Type": content_type},
                                 timeout=self.timeout)
        except Exception as exc:
            raise self._fail(f"the upload of {key}", exc) from None
        if _status_code(resp) not in (200, 201):
            raise self._fail(f"the upload of {key}", resp=resp)

    def delete_download(self, key: str) -> None:
        """Remove one stale yearly download file, and nothing else: THE ONLY
        REMOVAL THIS CODE CAN MAKE. The key is checked here, whatever the
        caller chose (removal_refusal): it must be exactly downloads/<a yearly
        CSV file> and hold no mark of a database, a backup or another prefix.
        Any other key raises R2Error before a request is sent. Raises R2Error
        for any answer but 200 or 204."""
        refusal = removal_refusal(key)
        if refusal:
            raise R2Error(f"refused to remove an object: {refusal}")
        url = f"{self._base()}/{quote(key, safe='/')}"
        try:
            resp = self.http.delete(url, headers=self._headers(), timeout=self.timeout)
        except Exception as exc:
            raise self._fail(f"the removal of {key}", exc) from None
        if _status_code(resp) not in (200, 204):
            raise self._fail(f"the removal of {key}", resp=resp)


def r2_from_env(bucket: str | None = None) -> R2Rest | None:
    """The bucket through the run's token, when CLOUDFLARE_API_TOKEN and
    CLOUDFLARE_ACCOUNT_ID are in the environment (always in the workflow);
    None otherwise. The bucket is BUCKET from the environment, else the site's."""
    import os

    import requests

    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account:
        return None
    return R2Rest(requests.Session(), account, token, bucket or (os.environ.get("BUCKET") or "").strip() or DATA_BUCKET)


# -- monthly expiry checks ----------------------------------------------------

EXPIRY_WARN_DAYS = 30
CHECK_TIMEOUT_S = 30.0


def checks_due(today: date) -> bool:
    """The first run of a month is the one on its first day (UTC): the 12:30
    run, or a retry the same day when that one did not finish."""
    return today.day == 1


def _days_left(when: datetime, now: datetime) -> int:
    return int((when - now).total_seconds() // 86_400)


def verify_token(http: Any, token: str, account: str | None, now: datetime, label: str) -> dict[str, Any]:
    """The token's own status and expiry. A user token answers at
    /user/tokens/verify and an account-owned one at the account's address, so
    both are tried. Any answer other than a readable result is "unknown":
    a token the API rejects outright already fails the steps that use it."""
    urls = [f"{API}/user/tokens/verify"]
    if account:
        urls.append(f"{API}/accounts/{quote(account, safe='')}/tokens/verify")
    notes: list[str] = []
    for url in urls:
        try:
            resp = http.get(url, headers={"Authorization": f"Bearer {token}", "User-Agent": config.USER_AGENT},
                            timeout=CHECK_TIMEOUT_S)
        except Exception as exc:
            notes.append(f"request failed ({type(exc).__name__})")
            continue
        status = _status_code(resp)
        try:
            payload = resp.json()
        except Exception:
            payload = None
        result = payload.get("result") if isinstance(payload, dict) else None
        if status == 200 and isinstance(result, dict) and isinstance(result.get("status"), str):
            return _token_state(result, now, label)
        notes.append(f"HTTP {status}{_api_errors(resp)}")
    return {"state": "unknown", "detail": _scrub("; ".join(notes), token, account)[:200]}


def _token_state(result: dict[str, Any], now: datetime, label: str) -> dict[str, Any]:
    token_status = result["status"]
    expires = _parse_iso(result.get("expires_on"))
    out: dict[str, Any] = {"status": token_status, "expires_on": expires.isoformat(timespec="seconds") if expires else None}
    if expires:
        out["days_left"] = _days_left(expires, now)
    if token_status != "active":
        out["state"] = "inactive"
        out["item"] = f"The {label} is {token_status}, not active"
    elif expires and expires - now < timedelta(days=EXPIRY_WARN_DAYS):
        out["state"] = "expiring"
        out["item"] = (f"The {label} expires {expires.date()} ({max(out['days_left'], 0)} days): "
                       f"make a new one and replace the secret")
    else:
        out["state"] = "ok"
    return out


def domain_record(http: Any, token: str, account: str, domain: str, now: datetime) -> dict[str, Any]:
    """The registrar's expiry date and auto-renew flag. A token without the
    Registrar read permission gets 403: "unknown", nothing more."""
    if not account or not domain:
        return {"state": "unknown", "detail": "no account or domain configured"}
    url = f"{API}/accounts/{quote(account, safe='')}/registrar/domains/{quote(domain, safe='')}"
    try:
        resp = http.get(url, headers={"Authorization": f"Bearer {token}", "User-Agent": config.USER_AGENT},
                        timeout=CHECK_TIMEOUT_S)
    except Exception as exc:
        return {"state": "unknown", "detail": f"request failed ({type(exc).__name__})"}
    status = _status_code(resp)
    try:
        payload = resp.json()
    except Exception:
        payload = None
    result = payload.get("result") if isinstance(payload, dict) else None
    if status in (401, 403) or 10000 in _api_codes(resp):
        return {"state": "unknown", "detail": f"HTTP {status}: the token lacks the permission to read the registrar"}
    if status != 200 or not isinstance(result, dict):
        return {"state": "unknown", "detail": _scrub(f"HTTP {status}{_api_errors(resp)}", token, account)[:200]}
    expires = _parse_iso(result.get("expires_at"))
    auto = result.get("auto_renew")
    out: dict[str, Any] = {"expires_at": expires.isoformat(timespec="seconds") if expires else None,
                           "auto_renew": auto if isinstance(auto, bool) else None}
    if expires is None:
        out.update(state="unknown", detail="the registrar record has no expiry date")
        return out
    out["days_left"] = _days_left(expires, now)
    if expires - now < timedelta(days=EXPIRY_WARN_DAYS):
        renew = {True: "on", False: "off"}.get(out["auto_renew"], "unknown")
        out.update(state="expiring",
                   item=f"The domain {domain} expires {expires.date()} ({max(out['days_left'], 0)} days); auto-renew is {renew}")
    else:
        out["state"] = "ok"
    return out


def domain_of(site_url: str) -> str:
    host = urlsplit(site_url or "").hostname or ""
    return "" if not host or host.endswith(".example") else host


def run_checks(today: date, env: Mapping[str, str], http: Any, *, domain: str, now: datetime | None = None) -> dict[str, Any]:
    """The month's expiry checks, or {"due": False} on any other day. Never raises."""
    if not checks_due(today):
        return {"due": False, "date": today.isoformat(), "items": []}
    current = now or datetime.now(timezone.utc)
    deploy = (env.get("CLOUDFLARE_API_TOKEN") or "").strip()
    analytics = (env.get("CLOUDFLARE_ANALYTICS_TOKEN") or "").strip()
    account = (env.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    out: dict[str, Any] = {"due": True, "date": today.isoformat()}
    jobs: list[tuple[str, Callable[[], dict[str, Any]]]] = [
        ("deploy_token", lambda: verify_token(http, deploy, account, current, "deploy token (CLOUDFLARE_API_TOKEN)")
         if deploy else {"state": "not set"}),
        ("analytics_token", lambda: verify_token(http, analytics, account, current,
                                                 "analytics token (CLOUDFLARE_ANALYTICS_TOKEN)")
         if analytics else {"state": "not set"}),
        ("domain", lambda: domain_record(http, deploy, account, domain, current) if deploy
         else {"state": "unknown", "detail": "no token"}),
    ]
    for name, job in jobs:
        try:
            out[name] = job()
        except Exception as exc:
            out[name] = {"state": "unknown", "detail": f"the check failed ({type(exc).__name__})"}
    out["items"] = [out[name].pop("item") for name, _ in jobs if "item" in out[name]]
    return out


# -- attention items and the issue --------------------------------------------

ISSUE_TITLE = "Nightly run needs attention"
ISSUE_LABEL = "run-attention"
# The broken links the item names; status.json's link_sample_broken has the rest.
LINK_ITEM_MAX = 10


def link_item(broken: Any) -> str | None:
    """The item for the nightly link sample's links that answered 404 or 410
    (status.json link_sample_broken): up to LINK_ITEM_MAX of them, each with
    its kind, record reference, status and address; None when there are none."""
    entries = [b for b in broken if isinstance(b, dict) and isinstance(b.get("url"), str)] \
        if isinstance(broken, list) else []
    if not entries:
        return None
    named = "; ".join(f"{b.get('kind')} {b.get('ref')} ({b.get('status')}) {b['url']}" for b in entries[:LINK_ITEM_MAX])
    rest = len(entries) - LINK_ITEM_MAX
    more = f"; and {rest} more in status.json (link_sample_broken)" if rest > 0 else ""
    return (f"Outbound links: {len(entries)} sampled government link{'s' if len(entries) != 1 else ''} answered "
            f"404 or 410 at the source (the site keeps its links, since a page may come back): {named}{more}")


# The four checks the nightly's tests job runs on main, by the names its
# outputs give them, as the item names them.
TEST_CHECKS = {
    "typecheck": "the typecheck",
    "worker": "the Worker suite",
    "mail": "the mail suite",
    "pipeline": "the pipeline suite",
}


def tests_item(tests: Any) -> str | None:
    """The item for a night whose tests failed on main (status.json tests,
    verdict "fallback"): which checks failed, at which commit, and which
    commit the refresh ran instead. None for any other verdict."""
    if not isinstance(tests, dict) or tests.get("verdict") != "fallback":
        return None
    failed = tests.get("failed") if isinstance(tests.get("failed"), list) else []
    names = ", ".join(TEST_CHECKS[n] for n in failed if n in TEST_CHECKS) or "a check"

    def short(value: Any) -> str | None:
        return value[:COMMIT_TAG_LEN] if isinstance(value, str) and COMMIT_RE.fullmatch(value) else None

    main, ran = short(tests.get("main")), short(tests.get("ran"))
    if main is not None and main == ran:
        return (f"The tests failed on main ({names}) at {main}, which is also the commit that was live, "
                f"so tonight's refresh ran from main with its tests failing")
    return (f"The tests failed on main ({names}) at {main or 'an unknown commit'}; tonight's refresh ran from "
            f"{ran or 'an unknown commit'}, the commit that was live")


def databases_ahead(status: Any) -> str | None:
    """The fixed words for a night on which the search or the records database
    was synced (its outcome "synced") while tonight's pages did not go live:
    the deploy step's outcome is known and not success (failed, cancelled, or
    skipped after the bundle failed), or the deploy was rolled back. The two
    databases are synced before the deploy on purpose (the hourly delivery run
    reads the records database once the deployed data date is today), so they
    hold tonight's rows while the pages are last night's until the next
    deploy. None on any other night. Names which of the two were synced."""
    if not isinstance(status, dict):
        return None
    synced = [name for name, field in (("search", "search_sync"), ("records", "records_sync"))
              if status.get(field) == "synced"]
    if not synced:
        return None
    steps = status.get("steps") if isinstance(status.get("steps"), dict) else {}
    deploy = steps.get("deploy")
    rolled = status.get("deploy_rolled_back") is True
    if not rolled and not (isinstance(deploy, str) and deploy and deploy != "success"):
        return None
    why = "tonight's deploy was rolled back" if rolled else "tonight's deploy did not go through"
    if len(synced) == 2:
        return (f"the search and records databases were synced tonight, but {why}, so they are a night ahead "
                f"of the pages until the next deploy")
    return (f"the {synced[0]} database was synced tonight, but {why}, so it is a night ahead of the pages "
            f"until the next deploy")


# -- the bucket before and after a removal --------------------------------------


def inventory(objects: Any) -> dict[str, tuple[Any, Any]]:
    """key -> (size, etag) for each object of a listing: what the prune of old
    download files records of the whole bucket before it removes anything,
    and compares after."""
    out: dict[str, tuple[Any, Any]] = {}
    for o in objects or []:
        if isinstance(o, dict) and isinstance(o.get("key"), str):
            out[o["key"]] = (o.get("size"), o.get("etag"))
    return out


def backup_missing(held: Mapping[str, Any], base: str, parts_suffix: str = ".parts") -> str | None:
    """What of the nightly database backup the bucket does not hold (its
    manifest, or any part), or None when the manifest and at least one part
    are there. base is the set's name (nightly.BACKUP)."""
    part = re.compile(re.escape(base) + r"\.[0-9]{3}$")
    if base + parts_suffix not in held:
        return "its manifest is not in the bucket"
    if not any(part.fullmatch(k) for k in held):
        return "none of its parts is in the bucket"
    return None


def changed_objects(before: Mapping[str, Any], after: Mapping[str, Any], removed: Any) -> list[str]:
    """The keys held before that are gone or differ after (in size or etag),
    leaving out the keys the prune itself removed. An empty list says the
    removal touched nothing but what it named. A key that is new after is
    not a change to anything held."""
    gone = set(removed or ())
    return sorted(k for k, v in before.items() if k not in gone and after.get(k) != v)


# The source of the prune's notice (nightly.prune_downloads) in status.json.
PRUNE_SOURCE = "downloads_prune"
# The prune's outcome when the bucket after a removal is not the bucket before less the files it named.
PRUNE_ALARM = "alarm"


def prune_item(status: dict[str, Any]) -> str | None:
    """The item for a prune of old download files that refused to act
    (status.json downloads_prune "refused"), or whose check of the bucket
    after a removal found another object gone or changed ("alarm"): its
    notice, which says why and names the files; None for any other outcome."""
    if status.get(PRUNE_SOURCE) not in ("refused", PRUNE_ALARM):
        return None
    detail = next((n["detail"] for n in status.get("notices") or []
                   if isinstance(n, dict) and n.get("source") == PRUNE_SOURCE and isinstance(n.get("detail"), str)),
                  "refused, nothing deleted")
    return f"Old download files in R2: {detail}"


def attention_items(status: Any) -> list[str]:
    """What the run's last step lists. An empty list means a clean run."""
    if not isinstance(status, dict):
        return ["no run status was written"]
    # A deploy that did not go live after a sync: one line on the item the
    # deploy raises (its failed step, or its rollback), said once.
    ahead = databases_ahead(status)
    items = []
    for x in status.get("stages") or []:
        if not isinstance(x, dict) or x.get("ok"):
            continue
        item = f"{x.get('source')}: {x.get('detail', '')}"
        if ahead and x.get("source") == "workflow deploy":
            item, ahead = f"{item}; {ahead}", None
        items.append(item)
    if status.get("search_sync") == "failed":
        items.append("Search database sync: failed (sent again next run)")
    if status.get("records_sync") == "failed":
        items.append("Records database sync: failed (sent again next run)")
    if status.get("views_rollup") == "failed":
        items.append("Audience roll-up: failed (caught up next run)")
    if status.get("search_console") == "failed":
        items.append("Search Console import: failed (caught up next run)")
    if status.get("views_report") == "failed":
        items.append("Monthly audience report: failed (tried again next run)")
    # Only a rejection: the key file or the payload is wrong and stays wrong
    # until fixed. A rate limit or a failed request clears by itself, and the
    # sitemap still carries every page meanwhile.
    indexnow_outcome = status.get("indexnow")
    if isinstance(indexnow_outcome, str) and indexnow_outcome.startswith("rejected"):
        items.append("IndexNow: rejected; check the key file")
    links = link_item(status.get("link_sample_broken"))
    if links:
        items.append(links)
    # "saved" and "not due" say nothing; only an export or upload that failed.
    if status.get("accounts_backup") == "failed":
        items.append("Accounts database backup: the weekly export failed, so the newest copy in R2 "
                     "(backups/weekly/accounts-latest.sql.gz) is an earlier week's, or there is none")
    tests = tests_item(status.get("tests"))
    if tests:
        items.append(tests)
    prune = prune_item(status)
    if prune:
        items.append(prune)
    if status.get("smoke") == "broken":
        detail = status.get("smoke_detail") or "server errors"
        if status.get("deploy_rolled_back") is True:
            items.append(f"Deploy rolled back: the site answered with server errors after the deploy ({detail}); "
                         f"the Worker is back on version {status.get('version_before') or 'unknown'}, "
                         f"with the previous data, and a later run tries again" + (f"; {ahead}" if ahead else ""))
        else:
            items.append(f"Deploy broken: the site answered with server errors after the deploy ({detail}) "
                         f"and was not rolled back ({status.get('rollback') or 'not run'})")
    restore = status.get("restore")
    if isinstance(restore, dict) and restore.get("source") == "weekly":
        items.append(f"Restored from the weekly snapshot {restore.get('weekly_key')} "
                     f"(uploaded {restore.get('weekly_uploaded')}): both nightly backups were missing or damaged; "
                     f"the records published since that snapshot are read again from the source files by this "
                     f"and the next runs, and the first-seen dates of that week are the dates of the re-read")
    checks = status.get("checks")
    if isinstance(checks, dict):
        items.extend(f"Expiry check: {i}" for i in checks.get("items") or [] if isinstance(i, str))
    # The run's notices (notice_items) are not here: they never fail the step
    # or open the issue.
    return items


def notice_items(status: Any) -> list[str]:
    """The run's notices, one line each: a buyer spelling the seed does not map
    yet, a source file not published yet, a stage not built. Information,
    never an item needing attention: they go to LAST_RUN.md and the daily
    check's email, and the run stays ok."""
    if not isinstance(status, dict):
        return []
    return [f"{n.get('source') or 'notice'}: {n['detail']}" for n in status.get("notices") or []
            if isinstance(n, dict) and isinstance(n.get("detail"), str) and n["detail"]]


def issue_texts(items: list[str], run_url: str, day: str) -> dict[str, str]:
    """The issue body, the comment for a later run, and the closing comment."""
    numbered = "\n".join(f"{n}. {item}" for n, item in enumerate(items, 1))
    body = (f"The nightly run of {day} found {len(items)} item{'s' if len(items) != 1 else ''} needing attention:\n\n"
            f"{numbered}\n\nRun: {run_url}\n\n"
            "Each run updates this issue while an item remains, and the first run with none closes it.\n")
    comment = f"The run of {day} still finds:\n\n{numbered}\n\nRun: {run_url}\n"
    close = f"The run of {day} finished with nothing needing attention: {run_url}\n"
    return {"title": ISSUE_TITLE, "body": body, "comment": comment, "close": close}
