"""Checks and the run status for the nightly workflow.

The workflow calls these between its steps so that a failure anywhere never
publishes broken or empty data, never replaces a good backup with a worse
one, and always leaves a status file the site's daily check can read.

  restore   pick the database to start from: the backup, else the previous
            backup when the newest is damaged, else the newest weekly
            snapshot when both nightly sets are missing or damaged, else
            (only when nothing exists anywhere) an empty one. Exits 1 when a
            backup exists but cannot be used, so the run stops before it
            rebuilds from nothing.
  verify    check tonight's database and export; writes db_ok and export_ok
            for the save and deploy steps (to $GITHUB_OUTPUT when set).
  status    write status.json from the run's log rows, the workflow steps'
            outcomes and the checks, whatever state the run ended in.
  pack      write the backup the save step uploads: a copy of the database
            without its secondary indexes, checked, gzipped and split into
            parts of at most PART_MIB with a manifest of their SHA-256.
            Exits 1 when the copy fails its check.
  prev-set  re-split the backup the run restored from into the previous
            backup's parts, which the save step uploads before the new ones.
  split     split any gzip into a named set of parts (the weekly snapshot).
  gate      for a retry trigger: skip=true when today's run already
            finished clean (resilience.gate).
  live-version
            the Worker version serving traffic, from Wrangler's JSON, kept
            for a rollback.
  smoke     fetch the live site after a deploy: verdict ok, broken or
            unverifiable (resilience.smoke).
  checks    the monthly expiry checks of the tokens and the domain.
  attention list the items needing attention and write the GitHub issue's
            texts; exits 1 when there are any. The run's notices are
            printed beside them and never counted.
  notices   print the run's notices as a section for LAST_RUN.md (nothing
            when there are none); always exits 0.
  indexnow  after a deploy that worked: send the pages changed since the
            run's start to IndexNow (indexnow.py) and write the outcome.
            Exits 1 only when the key or the payload was rejected.
  site-bundle-check
            for the site-only deploy (deploy-site.yml): compare the data
            files of an unpacked static.tar.gz with the ones the live site
            serves (resilience.bundle_check). Exits 1 on any difference, a
            missing file or an answer other than 200, so that workflow
            stops before its deploy or rolls it back after.
  rollup-views, import-search-console, views-report
            the audience roll-up (views_rollup.py), the Search Console import
            (search_console.py) and the monthly report (views_report.py);
            each exits 1 only when it failed.

Backups travel in parts. Wrangler refuses a single R2 upload above 300 MiB,
and the database holds every published contract and grant agreement, so its
gzip passes that. A set is the parts <name>.000, <name>.001, ... and the
manifest <name>.parts, which lists each part's SHA-256 in order in the
SHA256SUMS layout. The manifest is uploaded last, so a set whose upload
stopped part way fails its hashes and the restore moves on to the previous
set; parts left over from a larger set are never read, since the manifest
names the parts that belong. A backup saved as one file (<name> alone) still
restores.

The R2 transfers stay in the workflow, apart from the weekly snapshot's
listing and download, which Wrangler has no command for; these commands read
the files the workflow leaves. verify, status, gate, live-version, smoke and
checks report what they find in their output and never stop the run. The
gate and attention commands run before the pipeline is installed, so this
module imports only the standard library at load; the audience and Search
Console modules are imported by their own commands.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from . import config, indexnow, resilience

log = logging.getLogger("awardwatch_pipeline.nightly")

BACKUP = "awardwatch.sqlite.gz"
PREVIOUS = "awardwatch.sqlite.prev.gz"
MISSING_TEXT = "specified key does not exist"
PARTS_SUFFIX = ".parts"
# Wrangler refuses a single-object R2 upload above 300 MiB
# (MAX_UPLOAD_SIZE_BYTES in its source); a part stays well under it.
PART_MIB = 250
# Three digits in a part's name: a thousand parts of 250 MiB is far beyond
# any database this pipeline will hold.
MAX_PARTS = 1000
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
# The nightly sets' part names, the only ones the restore accepts from a
# manifest (the workflow filters with the same pattern before it downloads).
NIGHTLY_PART_RE = re.compile(r"^awardwatch\.sqlite(\.prev)?\.gz\.\d{3}$")

# How far a count may fall between the restored backup and tonight's database
# before the new one is held back. The CanadaBuys tables (tender and award
# notices, contract history) are upserted and never deleted from, so any fall
# is a fault. Published contracts and grants are rewritten whole each run from
# files the publisher regenerates every day; a department withdrawing a
# quarter or two moves the count by a few per cent, while a file cut short in
# transit or a changed layout that drops rows moves it by half or more.
# Organizations no record points to are removed each night, and a change to
# the name rules merges spellings, so they get the same margin.
MIN_SHARE = {
    "tenders": 1.0,
    "awards": 1.0,
    "contract_history": 1.0,
    "contracts": 0.5,
    "grants": 0.5,
    "organizations": 0.5,
}
# The Worker accepts 20,000 files per version (its own assets included) and
# 25 MiB per file.
MAX_FILES = 19_000
MAX_FILE_BYTES = 25 * 1024 * 1024
# A file this much older than the run's start is left over from an earlier run.
CLOCK_SLACK_S = 120

# The longest notice part status.json keeps.
NOTICE_PART_MAX = 1200

STEP_DETAIL = {
    "restore": "the database could not be restored, so nothing else ran",
    "pipeline": "the pipeline exited with an error (see the stage rows)",
    "verify": "the checks could not run",
    "deploy": "the deploy failed; the site keeps the previous data",
    "save_db": "the database backup was not saved; R2 keeps the previous one",
    "save_files": "the public files were not all saved to R2",
}


# -- database ---------------------------------------------------------------


def _readable(path: Path) -> sqlite3.Connection | None:
    if not path.exists() or path.stat().st_size == 0:
        return None
    return sqlite3.connect(str(path))


def table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    out: dict[str, int] = {}
    for table in MIN_SHARE:
        try:
            out[table] = int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
        except sqlite3.Error:
            out[table] = 0
    return out


def check_db(path: Path, before: dict[str, int] | None = None) -> tuple[list[str], dict[str, int]]:
    """Problems with the database at path, and its table counts.

    Folds the write-ahead log into the main file first, so the file itself
    holds every committed row (the pack reads through the log as well).
    """
    conn = _readable(path)
    if conn is None:
        return ["the database file is missing or empty"], {}
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        result = [r[0] for r in conn.execute("PRAGMA quick_check")]
        if result != ["ok"]:
            return [f"the database failed its integrity check: {'; '.join(result)[:200]}"], {}
        counts = table_counts(conn)
    except sqlite3.Error as exc:
        return [f"the database cannot be read: {exc}"], {}
    finally:
        conn.close()
    problems = []
    for table, share in MIN_SHARE.items():
        was = (before or {}).get(table, 0)
        if was and counts.get(table, 0) < was * share:
            problems.append(f"{table} fell from {was} to {counts.get(table, 0)} rows")
    return problems, counts


# -- sets of parts ----------------------------------------------------------


def part_name(base_name: str, n: int) -> str:
    return f"{base_name}.{n:03d}"


def glob_escape(text: str) -> str:
    """A name as a literal inside a glob pattern."""
    return re.sub(r"([\[\]*?])", r"[\1]", text)


def split_parts(src_gz: Path, dest_dir: Path, base_name: str, part_bytes: int) -> list[str]:
    """Write src_gz as base_name.000, .001, ... of at most part_bytes each, and
    base_name.parts listing each part's SHA-256 in order. Returns the part names.

    Parts of the same name already in dest_dir go first, so a smaller set is
    never uploaded beside the leftovers of a larger one. The manifest is
    written last, through a partial file, in the order the upload follows."""
    if part_bytes <= 0:
        raise ValueError("a part must hold at least one byte")
    dest_dir.mkdir(parents=True, exist_ok=True)
    for old in dest_dir.glob(f"{glob_escape(base_name)}.[0-9][0-9][0-9]"):
        old.unlink()
    manifest = dest_dir / (base_name + PARTS_SUFFIX)
    manifest.unlink(missing_ok=True)
    names: list[str] = []
    lines: list[str] = []
    with src_gz.open("rb") as fin:
        while True:
            if len(names) >= MAX_PARTS:
                raise ValueError(f"{src_gz.name} needs more than {MAX_PARTS} parts")
            name = part_name(base_name, len(names))
            digest = hashlib.sha256()
            written = 0
            with (dest_dir / name).open("wb") as fout:
                while written < part_bytes:
                    chunk = fin.read(min(1 << 20, part_bytes - written))
                    if not chunk:
                        break
                    fout.write(chunk)
                    digest.update(chunk)
                    written += len(chunk)
            if written == 0 and names:
                # The file ended exactly on a part boundary.
                (dest_dir / name).unlink()
                break
            names.append(name)
            lines.append(f"{digest.hexdigest()}  {name}\n")
            if written < part_bytes:
                break
    partial = manifest.with_name(manifest.name + ".partial")
    partial.write_text("".join(lines), encoding="utf-8", newline="\n")
    partial.replace(manifest)
    return names


def read_manifest(path: Path, base_name: str) -> list[tuple[str, str]]:
    """[(sha256, part name)] in order. Raises ValueError when a line does not
    read, a name is not base_name.NNN counting up from 000, or there is none."""
    entries: list[tuple[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        fields = line.split()
        if len(fields) != 2 or not SHA_RE.match(fields[0]):
            raise ValueError(f"{path.name} has a line that does not read: {line[:80]!r}")
        want = part_name(base_name, len(entries))
        if fields[1] != want:
            raise ValueError(f"{path.name} names {fields[1][:80]!r} where {want} belongs")
        entries.append((fields[0], fields[1]))
    if not entries:
        raise ValueError(f"{path.name} lists no part")
    return entries


def join_parts(folder: Path, entries: list[tuple[str, str]], dest: Path) -> str | None:
    """Concatenate the listed parts in folder into dest, checking each hash;
    the reason when a part is missing or differs (nothing is left at dest then)."""
    partial = dest.with_name(dest.name + ".joining")
    try:
        with partial.open("wb") as fout:
            for sha, name in entries:
                part = folder / name
                if not part.exists():
                    return f"{name} is missing"
                digest = hashlib.sha256()
                with part.open("rb") as fin:
                    for chunk in iter(lambda: fin.read(1 << 20), b""):
                        digest.update(chunk)
                        fout.write(chunk)
                if digest.hexdigest() != sha:
                    return f"{name} does not match its manifest (an upload stopped part way?)"
        partial.replace(dest)
        return None
    except OSError as exc:
        return f"the parts could not be joined ({exc})"[:200]
    finally:
        partial.unlink(missing_ok=True)


# -- restore ----------------------------------------------------------------


def _gunzip(src: Path, dest: Path) -> str | None:
    """Decompress src to dest; the reason when it is not a complete gzip file."""
    try:
        with gzip.open(src, "rb") as fin, dest.open("wb") as fout:
            shutil.copyfileobj(fin, fout, 1 << 20)
        return None
    except (OSError, EOFError) as exc:
        dest.unlink(missing_ok=True)
        return f"not a complete gzip file ({exc})"


def _download(folder: Path, key: str) -> tuple[str, str]:
    """('ok' | 'missing' | 'failed', detail) for one download the workflow attempted."""
    exit_file = folder / f"{key}.exit"
    log_file = folder / f"{key}.log"
    log_text = log_file.read_text(encoding="utf-8", errors="replace") if log_file.exists() else ""
    code = exit_file.read_text(encoding="utf-8").strip() if exit_file.exists() else ""
    if code == "0" and (folder / key).exists() and (folder / key).stat().st_size > 0:
        return "ok", ""
    if MISSING_TEXT in log_text.lower():
        return "missing", ""
    tail = " ".join(log_text.split())[-200:]
    return "failed", f"download failed (exit {code or 'unknown'}): {tail}" if tail else f"download failed (exit {code or 'unknown'})"


def _candidate(folder: Path, key: str) -> tuple[str, str]:
    """('ok' | 'missing' | 'failed' | 'unusable', detail) for one backup in
    either form; on 'ok' the whole gzip is at folder/key.

    The parts form comes first. A manifest R2 said does not exist sends the
    restore to the single file; a manifest that failed to download does not,
    since the set it names may be the good one. A listed part R2 says does
    not exist, or one whose hash differs, makes the set unusable; a part whose
    download failed leaves it unknown ('failed'), which stops the run rather
    than falling back past a backup that may be whole. A manifest the workflow
    never asked for (no .exit file beside it) counts as missing."""
    manifest = key + PARTS_SUFFIX
    if not (folder / f"{manifest}.exit").exists():
        return _download(folder, key)
    state, detail = _download(folder, manifest)
    if state == "failed":
        return "failed", f"manifest: {detail}"
    if state == "missing":
        return _download(folder, key)
    try:
        entries = read_manifest(folder / (key + PARTS_SUFFIX), key)
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        return "unusable", str(exc)[:200]
    for _sha, name in entries:
        if not NIGHTLY_PART_RE.match(name):
            return "unusable", f"the manifest names {name[:80]!r}, which is not a backup part"
        part_state, part_detail = _download(folder, name)
        if part_state == "missing":
            return "unusable", f"{name} is listed but not in R2"
        if part_state == "failed":
            return "failed", f"{name}: {part_detail}"
    why = join_parts(folder, entries, folder / key)
    return ("unusable", why) if why else ("ok", "")


def _drop_sidecars(db: Path) -> None:
    for suffix in ("-wal", "-shm"):
        Path(f"{db}{suffix}").unlink(missing_ok=True)


def restore(folder: Path, db: Path, weekly: resilience.R2Rest | None = None) -> tuple[bool, str, str, dict[str, int]]:
    """Choose the starting database. Returns (go on, source, message, table
    counts), source being 'backup', 'previous', 'weekly' or 'none' (a first
    run). restore_record has the same decision with the weekly snapshot's
    key and upload time."""
    ok, record = restore_record(folder, db, weekly)
    return ok, record["source"], record["message"], record["counts"]


def restore_record(folder: Path, db: Path, weekly: resilience.R2Rest | None = None) -> tuple[bool, dict[str, Any]]:
    """(go on, the restore record written to restore.json).

    weekly reads the bucket's weekly snapshots; None (no token on a dev
    machine) leaves the decision to the two nightly backups."""
    tried: list[str] = []
    states = {}
    for key, source in ((BACKUP, "backup"), (PREVIOUS, "previous")):
        state, detail = _candidate(folder, key)
        states[key] = state
        if state != "ok":
            if state != "missing":
                tried.append(f"{key}: {detail}")
            continue
        why = _gunzip(folder / key, db)
        if why is None:
            problems, counts = check_db(db)
            if not problems:
                return True, {"source": source, "message": f"restored from {key}", "counts": counts}
            why = problems[0]
            db.unlink(missing_ok=True)
        states[key] = "unusable"
        tried.append(f"{key}: {why}")
    _drop_sidecars(db)
    both_missing = states.get(BACKUP) == "missing" and states.get(PREVIOUS) == "missing"
    # Only when R2 answered for both backups. A download that failed may hide a
    # good backup, and a week-old snapshot saved over it would lose the days
    # between, so an outage still stops the run.
    answered = all(states.get(k) in ("missing", "unusable") for k in (BACKUP, PREVIOUS))
    if weekly is not None and answered:
        return _restore_weekly(folder, db, weekly, tried, both_missing)
    if both_missing:
        db.unlink(missing_ok=True)
        return True, {"source": "none", "message": "no backup in R2: first run, starting from an empty database", "counts": {}}
    # A backup exists (or may exist) but none could be used. Starting from an
    # empty database would rebuild the site from nothing and then replace the
    # backup with it, so the run stops here instead.
    return False, {"source": "none", "message": "; ".join(tried) or "no backup could be used", "counts": {}}


WEEKLY_FILE = "weekly.sqlite.gz"


def _fetch_weekly(folder: Path, weekly: resilience.R2Rest, key: str, dest: Path) -> str | None:
    """Download the weekly snapshot at key (a set's manifest, or a single file)
    into dest as one gzip; the reason when it is not whole. Raises
    resilience.R2Error when R2 does not answer as expected."""
    if not key.endswith(PARTS_SUFFIX):
        weekly.download(key, dest)
        return None
    prefix, _, manifest_name = key.rpartition("/")
    base = manifest_name[: -len(PARTS_SUFFIX)]
    raw = weekly.get_bytes(key, max_bytes=1 << 20)
    if raw is None:
        return f"{key} is listed but not in R2"
    local = folder / "weekly"
    local.mkdir(parents=True, exist_ok=True)
    (local / manifest_name).write_bytes(raw)
    try:
        entries = read_manifest(local / manifest_name, base)
    except (UnicodeDecodeError, ValueError) as exc:
        return str(exc)[:200]
    for _sha, name in entries:
        weekly.download(f"{prefix}/{name}" if prefix else name, local / name)
    return join_parts(local, entries, dest)


def _restore_weekly(folder: Path, db: Path, weekly: resilience.R2Rest, tried: list[str],
                    both_missing: bool) -> tuple[bool, dict[str, Any]]:
    def stop() -> tuple[bool, dict[str, Any]]:
        _drop_sidecars(db)
        return False, {"source": "none", "message": "; ".join(tried) or "no backup could be used", "counts": {}}

    try:
        newest = weekly.newest_weekly()
    except resilience.R2Error as exc:
        # Unknown whether a snapshot exists, so neither a fresh start nor a
        # restore: the run stops and the next one asks again.
        tried.append(f"weekly snapshots: {exc}")
        return stop()
    if newest is None:
        if both_missing:
            db.unlink(missing_ok=True)
            return True, {"source": "none", "counts": {},
                          "message": "no backup and no weekly snapshot in R2: first run, starting from an empty database"}
        tried.append("weekly snapshots: none in R2")
        return stop()
    key, uploaded = newest
    dest = folder / WEEKLY_FILE
    try:
        why = _fetch_weekly(folder, weekly, key, dest)
    except resilience.R2Error as exc:
        tried.append(f"{key}: {exc}")
        return stop()
    if why is None:
        why = _gunzip(dest, db)
    if why is None:
        problems, counts = check_db(db)
        if not problems:
            before = "; ".join(tried) if tried else "both nightly backups are missing"
            return True, {"source": "weekly", "counts": counts, "weekly_key": key, "weekly_uploaded": uploaded,
                          "message": f"restored from the weekly snapshot {key} (uploaded {uploaded}); {before}"[:600]}
        why = problems[0]
        db.unlink(missing_ok=True)
    tried.append(f"{key}: {why}")
    return stop()


# -- export -----------------------------------------------------------------


def _parse_time(text: str | None) -> float | None:
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.strip().replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def check_export(static: Path, started: float | None, before_organizations: int = 0) -> list[str]:
    """Problems that should keep tonight's export off the site."""
    if not static.is_dir():
        return ["no export was written"]
    problems: list[str] = []
    stats_path = static / "stats.json"
    if not stats_path.exists():
        return ["stats.json is missing"]
    if started is not None and stats_path.stat().st_mtime < started - CLOCK_SLACK_S:
        problems.append("stats.json is left over from an earlier run")
    organizations = 0
    try:
        stats = _load(stats_path)
        counted = _count(stats["counts"]["organizations"])
        if not isinstance(stats.get("data_as_of"), str):
            problems.append("stats.json has no data date")
        if counted is None:
            problems.append("stats.json has no organization count")
        else:
            organizations = counted
            # No organization at all is fine only where the restored database
            # had none either (a first run, before any record names a
            # supplier); after a night that had some, it is a broken run.
            if before_organizations and organizations < before_organizations * MIN_SHARE["organizations"]:
                problems.append(f"stats.json counts {organizations} organizations, down from {before_organizations}")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        problems.append(f"stats.json cannot be read: {exc}"[:200])
    # The open notices are the tender pages' list and the site-only deploy's
    # second bundle file.
    try:
        if not isinstance(_load(static / "tenders" / "open.json"), list):
            problems.append("tenders/open.json has the wrong shape")
    except (OSError, ValueError) as exc:
        problems.append(f"tenders/open.json cannot be read: {exc}"[:200])
    if organizations > 0 and not any((static / "profiles").glob("*.json")):
        problems.append("no profile files were written")
    if not (static / "sitemaps" / "index.xml").exists():
        problems.append("sitemaps/index.xml is missing")
    files = [p for p in static.rglob("*") if p.is_file()]
    if len(files) > MAX_FILES:
        problems.append(f"{len(files)} files, more than the {MAX_FILES} a deploy can carry")
    too_big = [p for p in files if p.stat().st_size > MAX_FILE_BYTES]
    if too_big:
        problems.append(f"{len(too_big)} files over 25 MiB, first {too_big[0].relative_to(static).as_posix()}")
    return problems


def verify(db: Path, static: Path, started: float | None, before: dict[str, int]) -> dict[str, Any]:
    db_problems, counts = check_db(db, before)
    export_problems = check_export(static, started, before.get("organizations", 0))
    return {
        "db_ok": not db_problems,
        "export_ok": not export_problems,
        "problems": db_problems + export_problems,
        "counts": counts,
    }


# -- status -----------------------------------------------------------------


def run_status(
    db: Path, started: str | None, verify_result: dict[str, Any] | None, steps: dict[str, str],
    now: datetime | None = None, *, search: str | None = None, views: str | None = None,
    restore_info: dict[str, Any] | None = None, smoke: dict[str, Any] | None = None,
    rollback: str | None = None, version_before: str | None = None, checks: dict[str, Any] | None = None,
    indexnow_outcome: str | None = None, search_console: str | None = None, views_report: str | None = None,
) -> dict[str, Any]:
    """status.json for the site's daily check. Every input may be missing: the
    status then says what is missing rather than failing to be written.

    search, views and indexnow_outcome are the outcomes the search database
    sync (not run until the hosted search ships), the audience roll-up
    ("rolled up", "no data", "no token" or "failed") and the IndexNow
    submission ("submitted <n> URLs", "rejected (<status>)", "rate limited",
    "failed" or "off") wrote; "not run" when the step did not run. So do
    search_console (the Search Console import: "imported <n> days", "up to
    date", "no credentials" or "failed") and views_report (the monthly
    audience report: "written", "not due", "waiting", "no data" or
    "failed"). They are reported beside the stages, not as stages, so a
    failed sync, roll-up, import, report or submission alerts without marking
    the data refresh failed.

    The resilience fields: steps (every workflow step's outcome, which the
    retry gate reads), restore (where the database came from), smoke (the
    check of the live site after the deploy), rollback and deploy_rolled_back
    (what was done about a broken deploy) and checks (the monthly expiry
    checks). A broken deploy marks the run not ok whether or not it was
    rolled back, so a retry trigger the same day deploys again."""
    stages: list[dict[str, Any]] = []
    notices: list[dict[str, str]] = []
    for name, result in steps.items():
        if result == "failure":
            stages.append({"source": f"workflow {name}", "ok": False, "detail": STEP_DETAIL.get(name, "the step failed")})
        elif result == "cancelled":
            stages.append({"source": f"workflow {name}", "ok": False, "detail": "the step was cancelled (the job's time limit?)"})
    conn = _readable(db)
    if conn is None:
        if steps.get("restore") != "failure":
            stages.append({"source": "database", "ok": False, "detail": "no database to read the run log from"})
    else:
        try:
            if started:
                rows = conn.execute(
                    "SELECT source, ok, detail FROM sources_log WHERE run_at >= ? ORDER BY id", (started,)
                ).fetchall()
                stages.extend({"source": s, "ok": bool(ok), "detail": (d or "")[:200]} for s, ok, d in rows)
                notices = _notices(conn, started)
            else:
                stages.append({"source": "pipeline", "ok": False, "detail": "the run never started its stages"})
        except sqlite3.Error as exc:
            stages.append({"source": "database", "ok": False, "detail": f"the run log cannot be read: {exc}"[:200]})
        finally:
            conn.close()
    if verify_result and verify_result.get("problems"):
        stages.append({"source": "checks", "ok": False, "detail": "; ".join(verify_result["problems"])[:200]})
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    verdict = smoke.get("verdict") if isinstance(smoke, dict) else None
    verdict = verdict if verdict in resilience.VERDICTS else "not run"
    if verdict == "broken":
        rolled = rollback or "not run"
    else:
        rolled = "not needed"
    restored: dict[str, Any] = {"source": "not run"}
    if isinstance(restore_info, dict):
        restored = {"source": str(restore_info.get("source") or "unknown")}
        for key in ("weekly_key", "weekly_uploaded"):
            if restore_info.get(key):
                restored[key] = str(restore_info[key])
    return {
        "run_at": stamp,
        "stages": stages,
        "steps": dict(steps),
        # The site's daily check reads this field; the step that sets it
        # ships with the hosted search database.
        "search_sync": search or "not run",
        "views_rollup": views or "not run",
        "search_console": search_console or "not run",
        "views_report": views_report or "not run",
        "indexnow": indexnow_outcome or "not run",
        "restore": restored,
        "smoke": verdict,
        "smoke_detail": str(smoke.get("detail") or "")[:300] if isinstance(smoke, dict) else "",
        "version_before": version_before if version_before and resilience.UUID_RE.match(version_before) else None,
        "rollback": rolled,
        "deploy_rolled_back": rolled == "rolled back",
        "checks": checks if isinstance(checks, dict) else {"due": None, "items": [], "detail": "the checks did not run"},
        # Information that is not a failure (a buyer spelling no seed maps, a
        # file not published yet, a stage not built): LAST_RUN.md and the
        # daily check's email, never an item needing attention, and the run
        # stays ok.
        "notices": notices,
        "ok": all(s["ok"] for s in stages) and verdict != "broken",
    }


def _notices(conn: sqlite3.Connection, started: str) -> list[dict[str, str]]:
    """The run's notices from the log (a database from before the column has none)."""
    try:
        rows = conn.execute(
            "SELECT source, notice FROM sources_log WHERE run_at >= ? AND notice IS NOT NULL AND notice != '' ORDER BY id",
            (started,)).fetchall()
    except sqlite3.Error:
        return []
    # A stage may record several notices on one row, joined by " | ".
    return [{"source": s, "detail": part.strip()[:NOTICE_PART_MAX]} for s, n in rows
            for part in (n or "").split(" | ") if part.strip()]


# -- pack -------------------------------------------------------------------

# Only plain secondary indexes: a primary key or a UNIQUE constraint is part of
# the table and stays. A commented-out line never matches.
INDEX_RE = re.compile(r'^\s*CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?', re.IGNORECASE | re.MULTILINE)


def schema_indexes(schema_path: Path | None = None) -> list[str]:
    """Names of the secondary indexes schema.sql creates."""
    return INDEX_RE.findall((schema_path or config.SCHEMA_PATH).read_text(encoding="utf-8"))


def _mib(n: int) -> str:
    return f"{n / (1024 * 1024):.1f} MiB"


def pack(db: Path, out: Path, part_mib: float = PART_MIB,
         schema_path: Path | None = None) -> tuple[bool, str, dict[str, int]]:
    """Write the backup the save step uploads. Returns (ok, message, sizes in bytes).

    out is the whole gzip (kept for the weekly snapshot, never uploaded as
    one file); beside it go its parts, out.000, out.001, ..., and the
    manifest out.parts, which are what the save step uploads.

    Why not gzip the file as it is: about a fifth of it is the secondary
    indexes, which db.connect rebuilds from schema.sql whenever a restored
    copy is opened. And a step killed at its time limit can leave committed
    rows in the write-ahead log beside the file, which a gzip of the file
    alone would lose; VACUUM INTO reads them. The copy is checked before it
    is compressed, so a backup that would not open is never uploaded.
    """
    sizes: dict[str, int] = {}
    src = _readable(db)
    if src is None:
        return False, f"{db} is missing or empty; nothing to pack", sizes
    sizes["db"] = db.stat().st_size
    wal = Path(f"{db}-wal")
    sizes["wal"] = wal.stat().st_size if wal.exists() else 0
    out.parent.mkdir(parents=True, exist_ok=True)
    copy = out.with_name(out.name + ".copy.sqlite")
    partial = out.with_name(out.name + ".partial")
    for leftover in (copy, Path(f"{copy}-journal"), partial):
        leftover.unlink(missing_ok=True)
    names: list[str] = []
    try:
        try:
            src.execute("VACUUM INTO ?", (str(copy),))
        finally:
            src.close()
        conn = sqlite3.connect(str(copy))
        try:
            # Rollback journal, so every change below lands in the one file
            # that is compressed.
            conn.execute("PRAGMA journal_mode = DELETE")
            indexes = schema_indexes(schema_path)
            for name in indexes:
                conn.execute(f'DROP INDEX IF EXISTS "{name}"')
            conn.commit()
            conn.execute("VACUUM")
            result = [r[0] for r in conn.execute("PRAGMA quick_check")]
        finally:
            conn.close()
        if result != ["ok"]:
            return False, f"the packed copy failed its integrity check: {'; '.join(result)[:200]}", sizes
        sizes["copy"] = copy.stat().st_size
        with copy.open("rb") as fin, gzip.open(partial, "wb", compresslevel=6) as fout:
            shutil.copyfileobj(fin, fout, 1 << 20)
        sizes["gz"] = partial.stat().st_size
        partial.replace(out)
        names = split_parts(out, out.parent, out.name, max(int(part_mib * 1024 * 1024), 1))
    except (sqlite3.Error, OSError, ValueError) as exc:
        partial.unlink(missing_ok=True)
        return False, f"the database could not be packed: {exc}"[:300], sizes
    finally:
        copy.unlink(missing_ok=True)
        Path(f"{copy}-journal").unlink(missing_ok=True)
    sizes["parts"] = len(names)
    summary = (f"{db.name} {_mib(sizes['db'])} (write-ahead log {_mib(sizes['wal'])}), copy without its "
               f"{len(indexes)} secondary indexes {_mib(sizes['copy'])}, {out.name} {_mib(sizes['gz'])} "
               f"in {len(names)} part{'s' if len(names) != 1 else ''} of at most {part_mib:g} MiB")
    return True, summary, sizes


def prev_set(folder: Path, out_dir: Path, part_mib: float = PART_MIB) -> list[str]:
    """The backup the run restored from (folder/BACKUP, whole: the restore
    joined its parts there) as the previous backup's set in out_dir.
    Raises OSError when it is not there."""
    src = folder / BACKUP
    if not src.is_file() or src.stat().st_size == 0:
        raise OSError(f"{src} is missing or empty")
    return split_parts(src, out_dir, PREVIOUS, max(int(part_mib * 1024 * 1024), 1))


# -- command line -----------------------------------------------------------


def _read(path: str | None) -> str | None:
    if not path or not Path(path).exists():
        return None
    return Path(path).read_text(encoding="utf-8").strip() or None


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")


def _read_json(path: str | None) -> Any:
    """A JSON file the workflow left, or None when it is missing or unreadable."""
    try:
        text = _read(path)
        return json.loads(text) if text else None
    except (OSError, ValueError):
        return None


def _output(**pairs: str) -> None:
    """Step outputs for the workflow's conditions, when run inside one."""
    target = os.environ.get("GITHUB_OUTPUT")
    if not target:
        return
    with open(target, "a", encoding="utf-8") as fh:
        for name, value in pairs.items():
            fh.write(f"{name}={value}\n")


def _session() -> Any:
    import requests
    return requests.Session()


def _weekly_source(bucket: str) -> resilience.R2Rest | None:
    """The weekly snapshots, readable when the run's token is in the
    environment (always in the workflow; seldom on a dev machine)."""
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account:
        return None
    try:
        return resilience.R2Rest(_session(), account, token, bucket)
    except Exception as exc:
        log.warning("restore: the weekly snapshots cannot be read (%s)", type(exc).__name__)
        return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="awardwatch_pipeline.nightly")
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("restore")
    r.add_argument("--dir", required=True, help="folder holding the downloads and their .exit and .log files")
    r.add_argument("--db", required=True)
    r.add_argument("--out", required=True, help="where to write the restore record (source, counts)")
    r.add_argument("--bucket", default=os.environ.get("BUCKET") or resilience.DATA_BUCKET,
                   help=f"the R2 bucket holding backups/weekly/ (default $BUCKET, else {resilience.DATA_BUCKET})")
    v = sub.add_parser("verify")
    v.add_argument("--db", required=True)
    v.add_argument("--static", required=True)
    v.add_argument("--started-file", default=None)
    v.add_argument("--restore", default=None, help="the restore record, for the counts before the run")
    v.add_argument("--out", required=True)
    s = sub.add_parser("status")
    s.add_argument("--db", required=True)
    s.add_argument("--started-file", default=None)
    s.add_argument("--verify", default=None)
    s.add_argument("--search-outcome", default=None, help="the search database sync's outcome file")
    s.add_argument("--views-outcome", default=None, help="the audience roll-up's outcome file")
    s.add_argument("--indexnow-outcome", default=None, help="the IndexNow submission's outcome file")
    s.add_argument("--search-console-outcome", default=None, help="the Search Console import's outcome file")
    s.add_argument("--views-report-outcome", default=None, help="the monthly audience report's outcome file")
    s.add_argument("--restore", default=None, help="the restore record")
    s.add_argument("--smoke", default=None, help="the smoke test's result file")
    s.add_argument("--rollback-outcome", default=None, help="the rollback step's outcome file")
    s.add_argument("--version-before", default=None, help="the file holding the version live before the deploy")
    s.add_argument("--checks", default=None, help="the expiry checks' result file")
    s.add_argument("--step", action="append", default=[], help="name=outcome of a workflow step")
    s.add_argument("--out", required=True)
    pk = sub.add_parser("pack")
    pk.add_argument("--db", required=True)
    pk.add_argument("--out", required=True, help="the gzip to write; its parts and manifest go beside it")
    pk.add_argument("--part-mib", type=float, default=PART_MIB,
                    help=f"the largest part, in MiB (default {PART_MIB}; Wrangler refuses one upload above 300)")
    ps = sub.add_parser("prev-set", help="re-split the restored backup as the previous backup's parts")
    ps.add_argument("--dir", required=True, help="the restore folder, holding the whole awardwatch.sqlite.gz")
    ps.add_argument("--out-dir", required=True, help="where the previous set's parts and manifest are written")
    ps.add_argument("--part-mib", type=float, default=PART_MIB)
    sp = sub.add_parser("split", help="split a gzip into a named set of parts and its manifest")
    sp.add_argument("--src", required=True)
    sp.add_argument("--base", required=True, help="the set's name (its parts are <base>.000 ...)")
    sp.add_argument("--out-dir", required=True)
    sp.add_argument("--part-mib", type=float, default=PART_MIB)
    g = sub.add_parser("gate", help="skip=true when today's run already finished clean")
    g.add_argument("--status", required=True, help="status.json as downloaded from R2 (may be missing)")
    g.add_argument("--today", required=True, help="today's UTC date, YYYY-MM-DD")
    lv = sub.add_parser("live-version", help="the Worker version serving traffic, from Wrangler's JSON")
    lv.add_argument("--file", required=True, help="the output of `wrangler deployments status --json`")
    lv.add_argument("--out", default=None, help="write the version id here as well")
    sm = sub.add_parser("smoke", help="check the live site after a deploy")
    sm.add_argument("--base-url", required=True)
    sm.add_argument("--data-date", default=None, help="the data date the home and data pages must show")
    sm.add_argument("--stats", default=None, help="stats.json: the data date when --data-date is not given, "
                                                   "and the organization whose profile is fetched")
    sm.add_argument("--out", required=True)
    sm.add_argument("--settle", type=float, default=resilience.SMOKE_SETTLE_S,
                    help="seconds to wait before the first request")
    ck = sub.add_parser("checks", help="the monthly expiry checks (the first day of a month, UTC)")
    ck.add_argument("--today", required=True, help="today's UTC date, YYYY-MM-DD")
    ck.add_argument("--domain", default=resilience.domain_of(config.SITE_URL),
                    help="the domain whose registrar record is read (default: the site's host)")
    ck.add_argument("--out", required=True)
    bc = sub.add_parser("site-bundle-check", help="prove an unpacked static.tar.gz is what the live site serves")
    bc.add_argument("--bundle", required=True, help="the unpacked archive's static folder (stats.json at its top)")
    bc.add_argument("--base-url", required=True, help="the live site, whose /data/ files are fetched")
    bc.add_argument("--saved-stats", default=None,
                    help="stats.json as saved from the live site before the deploy; the archive's copy must match it too")
    bc.add_argument("--keep-live-stats", default=None,
                    help="write the live stats.json bytes here, only when every comparison matched")
    bc.add_argument("--title", default="Data files compared", help="the heading of the run summary's table")
    bc.add_argument("--retry-after", type=float, default=resilience.BUNDLE_RETRY_S,
                    help="seconds before a file the site did not answer 200 for is fetched again")
    at = sub.add_parser("attention", help="list the items needing attention; exit 1 when there are any")
    at.add_argument("--status", required=True)
    at.add_argument("--run-url", required=True)
    at.add_argument("--out-dir", required=True, help="where the issue's texts are written")
    nt = sub.add_parser("notices", help="print the run's notices as a section for LAST_RUN.md")
    nt.add_argument("--status", required=True)
    ix = sub.add_parser("indexnow", help="send the pages changed since the run's start to IndexNow")
    ix.add_argument("--db", required=True)
    ix.add_argument("--since", required=True,
                    help="the run's start, an ISO time in UTC (the workflow's data/out/run_started.txt)")
    ix.add_argument("--site-url", default=config.SITE_URL, help="the live site (default $AWARDWATCH_SITE_URL)")
    ix.add_argument("--out-dir", default=None,
                    help="where last_outcome.txt and urls.txt are written (default data/out/indexnow)")
    ix.add_argument("--dry-run", action="store_true", help="select and list the URLs, send nothing")
    # The audience counts (views_rollup.py, docs/search-engines.md section 6):
    # the days Analytics Engine still holds and summary.csv lacks, as files
    # the workflow uploads to R2. Needs CLOUDFLARE_ANALYTICS_TOKEN and
    # CLOUDFLARE_ACCOUNT_ID; without the token it does nothing.
    rv = sub.add_parser("rollup-views", help="save the audience counts of finished UTC days as CSV files")
    rv.add_argument("--out", default=None,
                    help="folder holding summary.csv; the day files go beside it (default data/out/views)")
    rv.add_argument("--day", default=None,
                    help="roll up this UTC day only (YYYY-MM-DD, within the last 90 days); default: every day due")
    rv.add_argument("--stats", default=None,
                    help="tonight's stats.json, for the organization and record counts (default data/out/static/stats.json)")
    # Search Console's figures (search_console.py, docs/search-engines.md
    # section 6): every final day after the newest in search_console.csv.
    # Needs GSC_SERVICE_ACCOUNT_JSON; without it the outcome is "no credentials".
    gs = sub.add_parser("import-search-console", help="append Search Console's daily figures to search_console.csv")
    gs.add_argument("--out", default=None,
                    help="folder holding search_console.csv; outcome.txt goes beside it (default data/out/search_console)")
    # The monthly audience report (views_report.py), from the files in R2.
    vp = sub.add_parser("views-report", help="write the audience report of a finished UTC month")
    vp.add_argument("--month", default=None, help="YYYY-MM (default: the month before today, UTC)")
    vp.add_argument("--summary", required=True, help="views/summary.csv as downloaded from R2")
    vp.add_argument("--search", default=None, help="views/search_console.csv as downloaded from R2, when it exists")
    vp.add_argument("--out", required=True, help="folder for report-<month>.md, summary_line.txt and outcome.txt")
    vp.add_argument("--today", default=None, help="YYYY-MM-DD (default: today, UTC)")
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    handlers = {
        "pack": _pack, "prev-set": _prev_set, "split": _split, "restore": _restore, "verify": _verify,
        "status": _status, "gate": _gate, "live-version": _live_version, "smoke": _smoke, "checks": _checks,
        "attention": _attention, "notices": _notice_section, "site-bundle-check": _site_bundle_check,
        "indexnow": _indexnow, "rollup-views": _rollup_views, "import-search-console": _import_search_console,
        "views-report": _views_report,
    }
    return handlers[args.command](args)


def _pack(args: argparse.Namespace) -> int:
    ok, message, _ = pack(Path(args.db), Path(args.out), args.part_mib)
    (log.info if ok else log.error)("pack: %s", message)
    return 0 if ok else 1


def _prev_set(args: argparse.Namespace) -> int:
    try:
        names = prev_set(Path(args.dir), Path(args.out_dir), args.part_mib)
    except (OSError, ValueError) as exc:
        log.error("prev-set: %s", exc)
        return 1
    log.info("prev-set: %d part(s) and %s%s in %s", len(names), PREVIOUS, PARTS_SUFFIX, args.out_dir)
    return 0


def _split(args: argparse.Namespace) -> int:
    try:
        names = split_parts(Path(args.src), Path(args.out_dir), args.base, max(int(args.part_mib * 1024 * 1024), 1))
    except (OSError, ValueError) as exc:
        log.error("split: %s", exc)
        return 1
    log.info("split: %d part(s) and %s%s in %s", len(names), args.base, PARTS_SUFFIX, args.out_dir)
    return 0


def _restore(args: argparse.Namespace) -> int:
    ok, record = restore_record(Path(args.dir), Path(args.db), _weekly_source(args.bucket))
    _write_json(Path(args.out), record)
    (log.info if ok else log.error)("restore: %s", record["message"])
    return 0 if ok else 1


def _verify(args: argparse.Namespace) -> int:
    try:
        record = json.loads(_read(args.restore) or "{}")
    except ValueError:
        record = {}
    counts = record.get("counts") if isinstance(record, dict) else None
    result = verify(Path(args.db), Path(args.static), _parse_time(_read(args.started_file)),
                    counts if isinstance(counts, dict) else {})
    _write_json(Path(args.out), result)
    for p in result["problems"]:
        log.warning("check: %s", p)
    _output(db_ok="true" if result["db_ok"] else "false", export_ok="true" if result["export_ok"] else "false")
    log.info("verify: db_ok=%s export_ok=%s", result["db_ok"], result["export_ok"])
    return 0


def _status(args: argparse.Namespace) -> int:
    verify_result = None
    try:
        verify_result = json.loads(_read(args.verify) or "null")
    except ValueError:
        verify_result = {"problems": ["the check results could not be read"]}
    steps = dict(item.split("=", 1) for item in args.step if "=" in item)
    status = run_status(Path(args.db), _read(args.started_file), verify_result, steps,
                        search=_read(args.search_outcome), views=_read(args.views_outcome),
                        restore_info=_read_json(args.restore), smoke=_read_json(args.smoke),
                        rollback=_read(args.rollback_outcome), version_before=_read(args.version_before),
                        checks=_read_json(args.checks), indexnow_outcome=_read(args.indexnow_outcome),
                        search_console=_read(args.search_console_outcome),
                        views_report=_read(args.views_report_outcome))
    _write_json(Path(args.out), status)
    print(json.dumps(status, indent=1))
    return 0


def _gate(args: argparse.Namespace) -> int:
    # Any fault here runs the refresh: a needless run costs minutes, a
    # wrongly skipped one costs the day.
    try:
        skip, reason = resilience.gate(_read_json(args.status), date.fromisoformat(args.today))
    except Exception as exc:
        skip, reason = False, f"the gate could not decide ({type(exc).__name__}), so the refresh runs"
    log.info("gate: %s", reason)
    _output(skip="true" if skip else "false")
    return 0


def _live_version(args: argparse.Namespace) -> int:
    version = resilience.live_version(_read(args.file) or "")
    if version is None:
        log.warning("live-version: no version id in %s, so a broken deploy cannot be rolled back tonight", args.file)
        return 1
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(version + "\n", encoding="utf-8")
    _output(version_id=version)
    log.info("live-version: %s", version)
    return 0


def _smoke(args: argparse.Namespace) -> int:
    stats = _read_json(args.stats)
    data_date = args.data_date or (stats.get("data_as_of") if isinstance(stats, dict) else None)
    data_date = data_date if isinstance(data_date, str) and data_date.strip() else None
    http = _session()
    try:
        result = resilience.smoke(http, args.base_url, data_date, resilience.smoke_paths(stats), settle=args.settle)
    finally:
        http.close()
    _write_json(Path(args.out), result)
    _output(verdict=result["verdict"])
    (log.error if result["verdict"] == "broken" else log.info)("smoke: %s: %s", result["verdict"], result["detail"])
    return 1 if result["verdict"] == "broken" else 0


def _checks(args: argparse.Namespace) -> int:
    today = date.fromisoformat(args.today)
    http = _session() if resilience.checks_due(today) else None
    try:
        result = resilience.run_checks(today, os.environ, http, domain=args.domain)
    finally:
        if http is not None:
            http.close()
    _write_json(Path(args.out), result)
    if not result["due"]:
        log.info("checks: not due (they run on the first day of a month)")
        return 0
    for name in ("deploy_token", "analytics_token", "domain"):
        entry = result.get(name) or {}
        log.info("checks: %s: %s%s", name, entry.get("state"), f" ({entry['detail']})" if entry.get("detail") else "")
    for item in result["items"]:
        log.warning("checks: %s", item)
    return 0


def _attention(args: argparse.Namespace) -> int:
    status = _read_json(args.status)
    items = resilience.attention_items(status)
    run_at = status.get("run_at") if isinstance(status, dict) else None
    day = run_at[:10] if isinstance(run_at, str) and len(run_at) >= 10 else datetime.now(timezone.utc).date().isoformat()
    texts = resilience.issue_texts(items, args.run_url, day)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "items.txt").write_text("".join(f"{i}\n" for i in items), encoding="utf-8")
    for name, file in (("title", "title.txt"), ("body", "body.md"), ("comment", "comment.md"), ("close", "close.md")):
        (out / file).write_text(texts[name], encoding="utf-8")
    for item in items:
        print("ATTENTION:", item)
    # Notices are information: shown in the step's log, never counted, so
    # they neither fail the step nor open the issue.
    for notice in resilience.notice_items(status):
        print("NOTICE:", notice)
    return 1 if items else 0


def _notice_section(args: argparse.Namespace) -> int:
    """The run's notices for LAST_RUN.md, one per line; nothing when there are none."""
    notices = resilience.notice_items(_read_json(args.status))
    if notices:
        print("Notices from this run (information; nothing failed):")
        print()
        for notice in notices:
            print(f"- {' '.join(notice.split())}")
    return 0


def _indexnow(args: argparse.Namespace) -> int:
    # Exit 1 only for a rejection: the key file or the payload is wrong and
    # stays wrong until someone fixes it, so the step shows red. A rate limit
    # or an outage clears by itself; the run status records it either way.
    out = Path(args.out_dir) if args.out_dir else config.OUT_DIR / "indexnow"
    record = indexnow.run(Path(args.db), args.since, args.site_url, out, http_factory=_session, dry_run=args.dry_run)
    rejected = record["outcome"].startswith("rejected")
    detail = f" ({record['detail']})" if record.get("detail") else ""
    (log.error if rejected else log.info)("indexnow: %s%s", record["outcome"], detail)
    log.info("indexnow: %d URLs selected, %d accepted, %d of %d batches sent; the list is in %s",
             record["urls"], record["accepted"], record["sent"], record["batches"], out / indexnow.URLS_FILE)
    return 1 if rejected else 0


def _rollup_views(args: argparse.Namespace) -> int:
    """Exit 1 only when the roll-up failed. The workflow writes the outcome
    for the run status itself, after the uploads, because a night counts as
    rolled up only once its files are in R2."""
    from . import views_rollup

    day = date.fromisoformat(args.day) if args.day else None
    outcome = views_rollup.run(Path(args.out) if args.out else None, day=day,
                               stats_path=Path(args.stats) if args.stats else None)
    log.info("rollup-views: %s", outcome)
    print(f"rollup-views: {outcome}")
    return 1 if outcome == "failed" else 0


def _import_search_console(args: argparse.Namespace) -> int:
    """Exit 1 only when the import failed. outcome.txt holds the outcome for the
    workflow, which reports it once the file is in R2."""
    from . import search_console

    folder = Path(args.out) if args.out else config.OUT_DIR / "search_console"
    outcome = search_console.run(folder)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "outcome.txt").write_text(outcome + "\n", encoding="utf-8")
    log.info("import-search-console: %s", outcome)
    print(f"import-search-console: {outcome}")
    return 1 if outcome == "failed" else 0


def _views_report(args: argparse.Namespace) -> int:
    """Exit 1 only when the report failed; "waiting" and "no data" are not failures."""
    from . import views_report

    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    month = args.month or views_report.report_month(today)
    out = Path(args.out)
    outcome = views_report.run(out, month, today, Path(args.summary), Path(args.search) if args.search else None)
    out.mkdir(parents=True, exist_ok=True)
    (out / "outcome.txt").write_text(outcome + "\n", encoding="utf-8")
    log.info("views-report %s: %s", month, outcome)
    print(f"views-report {month}: {outcome}")
    return 1 if outcome == "failed" else 0


def _summary(lines: list[str]) -> None:
    """Lines for the run's summary page, when run inside a workflow."""
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if not target:
        return
    with open(target, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n\n")


def _cell(text: Any) -> str:
    return str(text).replace("|", "\\|")


def _site_bundle_check(args: argparse.Namespace) -> int:
    http = _session()
    try:
        record, live_stats = resilience.bundle_check(
            http, args.base_url, Path(args.bundle), Path(args.saved_stats) if args.saved_stats else None,
            retry_after=args.retry_after)
    finally:
        http.close()
    files = record["files"]
    for f in files:
        (log.info if f["result"] == "same" else log.error)("site-bundle-check: %s", f["note"])
    rows = [f"#### {_cell(args.title)}", "", "| File | Compared with | Result |", "|---|---|---|"]
    rows += [f"| {_cell(f['file'])} | {_cell(f['against'])} | {_cell(f['result'])} |" for f in files]
    failed = [f for f in files if f["result"] != "same"]
    if failed:
        rows += ["", f"{len(failed)} of {len(files)} comparisons failed: " + "; ".join(_cell(f["note"]) for f in failed)]
        log.error("site-bundle-check: %d of %d comparisons failed", len(failed), len(files))
    else:
        log.info("site-bundle-check: %d comparisons, every file the same", len(files))
    _summary(rows)
    if record["ok"] and args.keep_live_stats and live_stats is not None:
        Path(args.keep_live_stats).parent.mkdir(parents=True, exist_ok=True)
        Path(args.keep_live_stats).write_bytes(live_stats)
    return 0 if record["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
