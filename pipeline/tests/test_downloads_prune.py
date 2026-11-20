"""The prune of old download files in R2 (nightly prune-downloads): which objects are stale, the report it ships
with, the deletion it can do against a fake bucket, every safety rule, the run status, and its workflow step."""

import json
import logging
import re
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import pytest

from awardwatch_pipeline import export, nightly, resilience
from awardwatch_pipeline.db import connect
from test_resilience import Resp

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "nightly.yml"
ACCOUNT = "abc123abc123abc123abc123abc123ab"
TOKEN = "tok-nightly-secret-value"
OBJECTS = f"/client/v4/accounts/{ACCOUNT}/r2/buckets/awardwatch-data/objects"

# What tonight's export writes: a file a year for each source from its first year, the before and after files,
# the fixed files and SHA256SUMS (export.py).
FIRST = {"awards": 2012, "history": 2009, "contracts": 2004, "grants": 2005}
YEARLY = [f"{src}-{y}.csv" for src, first in FIRST.items() for y in range(first, 2027)] + [
    "awards-before-2012.csv", "awards-after-2026.csv", "contracts-undated.csv", "grants-2021-2.csv"]
FIXED = ["open-tenders.csv", "organizations.csv", "organization-aliases.csv", "buyers.csv", "expiring-3m.csv",
         "expiring-6m.csv", "expiring-12m.csv"]
# Yearly names an earlier night wrote and tonight's export no longer does.
STALE = ["awards-2027.csv", "awards-2029.csv", "grants-2019-3.csv", "history-after-2025.csv"]
# Under the bucket and never stale: outside downloads/, a further slash, a near miss of the pattern, another file.
NEVER = ["awards-2027.csv", "views/summary.csv", "backups/weekly/db-slot-1.sqlite.gz.parts",
         "downloads/old/awards-2027.csv", "downloads/awards-2027.csv.bak", "downloads/Awards-2027.csv",
         "downloads/awards-2027-1.csv", "downloads/awards-2027-10.csv", "downloads/awards-27.csv",
         "downloads/expiring.csv", "downloads/SHA256SUMS.old", "downloads/awards-2027.csv\n", "downloads/"]
# The database's nightly backup, the one before it, a weekly snapshot and the run status: what a removal must
# see before it starts and find unchanged after.
BACKUPS = ["awardwatch.sqlite.gz.000", "awardwatch.sqlite.gz.001", "awardwatch.sqlite.gz.parts",
           "awardwatch.sqlite.prev.gz.000", "awardwatch.sqlite.prev.gz.parts",
           "backups/weekly/db-slot-7.sqlite.gz.000", "backups/weekly/db-slot-7.sqlite.gz.parts",
           "backups/weekly/d1-latest.sql.gz", "status.json", "static.tar.gz.000", "static.tar.gz.parts"]
# The download route's other prefix: counted, never stale, never touched (a yearly name there included).
MIRRORED = ["mirror/a.csv", "mirror/awards-2027.csv"]


class FakeBucket:
    """The bucket as the R2 REST API answers it (the shape test_resilience.FakeR2 serves): the listing by prefix,
    page by page with a cursor, and the removal of one object. Records every call."""

    def __init__(self, keys, *, page_size=None, answers=None, refuse=()):
        self.keys = set(keys)
        self.page_size = page_size
        self.answers = answers or {}  # prefix -> the answer every listing of it gets
        self.refuse = set(refuse)  # keys whose removal answers 500
        self.sizes = {}  # key -> size, where a test changes one
        self.etags = {}  # key -> etag, where a test changes one
        self.calls = []
        self.closed = False

    def get(self, url, headers=None, timeout=None, stream=False, **kwargs):
        self.calls.append(("GET", url, dict(headers or {})))
        parts = urlsplit(url)
        assert parts.scheme == "https" and parts.netloc == "api.cloudflare.com" and parts.path == OBJECTS
        query = parse_qs(parts.query)
        prefix = query.get("prefix", [""])[0]
        if prefix in self.answers:
            return self.answers[prefix]
        keys = sorted(k for k in self.keys if k.startswith(prefix))
        start = int(query.get("cursor", ["0"])[0])
        size = self.page_size or len(keys) or 1
        chunk = keys[start:start + size]
        more = start + size < len(keys)
        return Resp(200, json_data={
            "success": True, "errors": [],
            "result": [{"key": k, "last_modified": "2026-11-19T14:40:00.000Z", "size": self.sizes.get(k, 10),
                        "etag": self.etags.get(k, "e1")} for k in chunk],
            "result_info": {"is_truncated": more, "cursor": str(start + size) if more else "", "per_page": 100},
        })

    def delete(self, url, headers=None, timeout=None, **kwargs):
        self.calls.append(("DELETE", url, dict(headers or {})))
        parts = urlsplit(url)
        assert parts.scheme == "https" and parts.path.startswith(OBJECTS + "/")
        key = unquote(parts.path[len(OBJECTS) + 1:])
        if key in self.refuse:
            return Resp(500, json_data={"success": False, "errors": [{"code": 10001, "message": f"internal {TOKEN}"}]})
        self.keys.discard(key)
        return Resp(200, json_data={"success": True, "errors": [], "result": {}})

    def close(self):
        self.closed = True

    def deleted(self):
        return [unquote(urlsplit(u).path[len(OBJECTS) + 1:]) for m, u, _ in self.calls if m == "DELETE"]

    def listed(self, prefix):
        return [u for m, u, _ in self.calls
                if m == "GET" and parse_qs(urlsplit(u).query).get("prefix", [""]) == [prefix]]


def r2(fake):
    return resilience.R2Rest(fake, ACCOUNT, TOKEN, "awardwatch-data")


def export_folder(tmp_path, names=None, *, sums=True, name="csv"):
    folder = tmp_path / name
    folder.mkdir(exist_ok=True)
    for n in YEARLY + FIXED if names is None else names:
        (folder / n).write_text("x\n", encoding="utf-8")
    if sums:
        (folder / "SHA256SUMS").write_text("x\n", encoding="utf-8")
    return folder


def bucket(stale=STALE, **kw):
    keys = [f"downloads/{n}" for n in YEARLY + FIXED + ["SHA256SUMS"] + list(stale)] + NEVER + MIRRORED + BACKUPS
    return FakeBucket(keys, **kw)


REPORT = ("report only, nothing deleted: 4 yearly files under downloads/ that tonight's export no longer writes: "
          "awards-2027.csv, awards-2029.csv, grants-2019-3.csv, history-after-2025.csv; "
          "2 objects under mirror/ (never touched)")


# -- the pattern, the names and the mode -------------------------------------------------------


def test_the_yearly_pattern_is_the_one_the_site_serves():
    ts = (ROOT / "site" / "src" / "pages" / "data.tsx").read_text(encoding="utf-8")
    found = re.search(r"^export const YEARLY_DOWNLOAD = /(.+)/;$", ts, re.M)
    assert found and found.group(1) == nightly.YEARLY_DOWNLOAD_RE.pattern
    # The download route serves the yearly names and the other prefix the report counts (site/src/index.tsx).
    route = (ROOT / "site" / "src" / "index.tsx").read_text(encoding="utf-8")
    assert "YEARLY_DOWNLOAD.test(file)" in route and f"/^{nightly.MIRROR_PREFIX[:-1]}\\/" in route
    assert f'`{nightly.DOWNLOADS_PREFIX}${{file}}`' in route
    # The checksum file is the export's own; every name the export's test offers is a yearly or a fixed one.
    assert nightly.DOWNLOAD_SUMS == export.SUMS
    for name in YEARLY:
        assert nightly.YEARLY_DOWNLOAD_RE.fullmatch(name) and export.YEAR_RE.match(name), name


def test_the_mode_ships_as_report_and_nothing_outside_the_code_changes_it():
    assert nightly.PRUNE_MODE == "report"
    options = {a.dest for a in nightly.build_parser()._subparsers._group_actions[0].choices["prune-downloads"]._actions}
    assert options == {"help", "csv", "upload_outcome", "save_db_outcome", "out_dir", "bucket"}
    # The limits the docs and the workflow comment name.
    assert (nightly.PRUNE_CAP, nightly.PRUNE_FLOOR, nightly.PRUNE_NAMED) == (30, 30, 10)


def test_only_a_yearly_file_directly_under_downloads_that_tonight_did_not_send_is_stale():
    tonight = set(YEARLY + FIXED + ["SHA256SUMS"])
    keys = [f"downloads/{n}" for n in YEARLY + FIXED + ["SHA256SUMS"] + STALE] + NEVER + MIRRORED + [None, 7]
    assert nightly.stale_downloads(keys, tonight) == sorted(STALE)
    # SHA256SUMS and the fixed files are never stale, even when tonight did not send them.
    assert nightly.stale_downloads([f"downloads/{n}" for n in FIXED + ["SHA256SUMS"]], set()) == []
    assert nightly.stale_downloads(None, tonight) == []


def test_tonight_s_set_is_what_the_upload_loop_sends(tmp_path):
    folder = export_folder(tmp_path, ["awards-2020.csv", "organizations.csv", ".hidden.csv", "notes.txt"])
    (folder / "sub.csv").mkdir()
    assert nightly.uploaded_names(folder) == {"awards-2020.csv", "organizations.csv", "SHA256SUMS"}
    assert nightly.uploaded_names(tmp_path / "none") == set()
    # The loop the set mirrors.
    save = WORKFLOW.read_text(encoding="utf-8").split("- name: Save the public files to R2", 1)[1].split("\n      - ", 1)[0]
    assert "for f in data/out/csv/*.csv data/out/csv/SHA256SUMS; do" in save
    assert '[ -f "$f" ] || continue' in save and 'put "$BUCKET/downloads/$(basename "$f")" "$f"' in save


# -- report mode (as shipped) --------------------------------------------------------------------


def test_the_report_names_the_stale_files_counts_the_other_prefix_and_deletes_nothing(tmp_path):
    fake = bucket()
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success")
    assert record["outcome"] == "4 stale (reported)" and record["mode"] == "report"
    assert record["stale"] == sorted(STALE) and record["deleted"] == [] and record["mirror_objects"] == 2
    assert record["notice"] == REPORT
    assert fake.deleted() == [] and all(m == "GET" for m, _, _ in fake.calls)
    # The token travels in the header only.
    assert all(h["Authorization"] == f"Bearer {TOKEN}" and TOKEN not in u for _, u, h in fake.calls)
    # Nothing stale: said so, with the count, and still nothing deleted.
    quiet = nightly.prune_downloads(r2(bucket(stale=[])), export_folder(tmp_path, name="csv2"), "success")
    assert quiet["outcome"] == "none stale" and quiet["notice"] == (
        "report only, nothing deleted: no yearly file under downloads/ that tonight's export no longer writes; "
        "2 objects under mirror/ (never touched)")


def test_the_report_names_ten_at_most_then_the_rest_as_a_count(tmp_path):
    many = [f"history-{y}.csv" for y in range(1990, 2002)]
    record = nightly.prune_downloads(r2(bucket(stale=many)), export_folder(tmp_path), "success")
    assert record["outcome"] == "12 stale (reported)"
    named = record["notice"].split("no longer writes: ", 1)[1].split(";", 1)[0]
    assert named == ", ".join(many[:10]) + " and 2 others"
    assert nightly._named(["a.csv"] * 11).endswith(" and 1 other")


def test_every_page_of_the_listing_is_read(tmp_path):
    fake = bucket(page_size=7)
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success")
    assert record["outcome"] == "4 stale (reported)" and record["stale"] == sorted(STALE)
    under = sum(1 for k in fake.keys if k.startswith("downloads/"))
    assert len(fake.listed("downloads/")) == -(-under // 7) > 10


# -- delete mode, against the fake bucket ----------------------------------------------------------


def test_delete_mode_removes_each_stale_object_and_nothing_else(tmp_path):
    fake = bucket()
    held = len(fake.keys)
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success", mode="delete", save_db="success")
    assert record["outcome"] == "4 deleted" and record["mode"] == "delete" and record["objects_checked"] == held - 4
    assert fake.deleted() == [f"downloads/{n}" for n in sorted(STALE)]
    assert all(f"downloads/{n}" not in fake.keys for n in STALE)
    assert set(NEVER) | set(MIRRORED) <= fake.keys
    assert record["notice"] == (
        "deleted 4 yearly files under downloads/ that tonight's export no longer writes: awards-2027.csv, "
        f"awards-2029.csv, grants-2019-3.csv, history-after-2025.csv; the {held - 4} other objects in the bucket, the "
        "database backup among them, are as they were; 2 objects under mirror/ (never touched)")
    assert set(BACKUPS) <= fake.keys and len(fake.keys) == held - 4
    # The whole bucket was listed before the first removal and after the last, and at no other time.
    order = ["LIST" if m == "GET" and "prefix=" not in u else m for m, u, _ in fake.calls
             if m == "DELETE" or "prefix=" not in u]
    assert order == ["LIST"] + ["DELETE"] * 4 + ["LIST"]
    # The next night finds nothing and says nothing.
    again = nightly.prune_downloads(r2(fake), export_folder(tmp_path, name="next"), "success", mode="delete", save_db="success")
    assert (again["outcome"], again["notice"], fake.deleted()[4:]) == ("none stale", None, [])
    # A report never lists the whole bucket: it removes nothing, so it has nothing to compare.
    quiet = bucket()
    nightly.prune_downloads(r2(quiet), export_folder(tmp_path, name="report"), "success")
    assert quiet.listed("") == [] and quiet.deleted() == []


def test_a_removal_that_fails_is_reported_and_the_rest_go_on(tmp_path, caplog):
    fake = bucket(refuse={"downloads/awards-2029.csv"})
    with caplog.at_level(logging.INFO):
        record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success", mode="delete", save_db="success")
    assert fake.deleted() == [f"downloads/{n}" for n in sorted(STALE)]
    assert record["outcome"] == "3 deleted, 1 not deleted" and record["not_deleted"] == ["awards-2029.csv"]
    assert "not deleted, the removal failed (the next run tries again): awards-2029.csv" in record["notice"]
    assert "awards-2029.csv" in caplog.text and TOKEN not in caplog.text and TOKEN not in json.dumps(record)


def test_any_mode_but_delete_deletes_nothing(tmp_path):
    for mode in ("report", "Delete", "", "remove", None):
        fake = bucket()
        nightly.prune_downloads(r2(fake), export_folder(tmp_path, name=f"csv-{mode}"), "success", mode=mode, save_db="success")
        assert fake.deleted() == [], mode


# -- the safety rules ----------------------------------------------------------------------------


@pytest.mark.parametrize("upload", ["failure", "skipped", "cancelled", "", None, "Success"])
def test_only_an_upload_that_saved_every_file_lets_it_act(tmp_path, upload):
    fake = bucket()
    for mode in ("report", "delete"):
        record = nightly.prune_downloads(r2(fake), export_folder(tmp_path, name=f"csv-{mode}"), upload, mode=mode, save_db="success")
        assert (record["outcome"], record["notice"]) == ("skipped", None)
    assert fake.calls == []


@pytest.mark.parametrize("names, sums, why", [
    ([], False, "tonight's upload sent no file"),
    (YEARLY + FIXED, False, "tonight's upload sent no SHA256SUMS, which the export writes last"),
    (YEARLY[:29] + FIXED, True, "tonight's upload sent 29 yearly files, fewer than the 30 a whole export writes"),
    (FIXED, True, "tonight's upload sent 0 yearly files, fewer than the 30 a whole export writes"),
])
def test_an_upload_that_looks_like_a_broken_export_is_refused_before_anything_is_listed(tmp_path, names, sums, why):
    fake = bucket()
    for mode in ("report", "delete"):
        folder = export_folder(tmp_path, names, sums=sums, name=f"csv-{mode}")
        record = nightly.prune_downloads(r2(fake), folder, "success", mode=mode, save_db="success")
        assert (record["outcome"], record["notice"]) == ("refused", f"refused, nothing deleted: {why}")
    assert fake.calls == []
    # At the floor it goes on.
    floor = YEARLY[:30] + FIXED
    fake = FakeBucket([f"downloads/{n}" for n in floor])
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path, floor, name="floor"), "success")
    assert record["outcome"] == "none stale" and fake.calls != []


def test_more_stale_files_than_the_cap_are_refused_in_either_mode(tmp_path):
    many = [f"contracts-{y}.csv" for y in range(1970, 2001)]
    assert len(many) == nightly.PRUNE_CAP + 1
    for mode in ("report", "delete"):
        fake = bucket(stale=many)
        record = nightly.prune_downloads(r2(fake), export_folder(tmp_path, name=f"csv-{mode}"), "success", mode=mode, save_db="success")
        assert record["outcome"] == "refused" and fake.deleted() == [] and record["stale"] == many
        assert record["notice"] == (
            "refused, nothing deleted: 31 yearly files under downloads/ that tonight's export no longer writes, more "
            f"than the 30 one night may remove: {', '.join(many[:10])} and 21 others; 2 objects under mirror/ (never "
            "touched)")
    # At the cap it acts.
    fake = bucket(stale=many[:30])
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path, name="cap"), "success", mode="delete", save_db="success")
    assert record["outcome"] == "30 deleted" and len(fake.deleted()) == 30
    # The bucket as it stood when the cap was set: 21 stale files, which one night may report and remove.
    first = [f"awards-{y}.csv" for y in (*range(1996, 2012), 2027, 2028, 2029, 2030, 2040)]
    assert len(first) == 21
    fake = bucket(stale=first)
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path, name="first"), "success")
    assert record["outcome"] == "21 stale (reported)" and fake.deleted() == [] and record["stale"] == sorted(first)


def answers(prefix, answer):
    return bucket(answers={prefix: answer})


@pytest.mark.parametrize("answer, why", [
    (Resp(403, json_data={"success": False, "errors": [{"code": 10000, "message": f"Authentication error {TOKEN}"}]}),
     "the listing answered HTTP 403 (10000 Authentication error [token])"),
    (Resp(200, "<html>"), "the listing answered without JSON"),
    (Resp(200, json_data={"success": False, "result": []}), "the listing answered without a list of objects"),
    # Cut short with no cursor to go on: never read as the whole list.
    (Resp(200, json_data={"success": True, "result": [{"key": "downloads/awards-2027.csv"}],
                          "result_info": {"is_truncated": True, "cursor": ""}}),
     "the listing was cut short and gave no cursor to continue it"),
    # A cursor that never ends.
    (Resp(200, json_data={"success": True, "result": [{"key": "downloads/awards-2027.csv"}],
                          "result_info": {"is_truncated": True, "cursor": "again"}}),
     f"the listing did not end after {resilience.MAX_LIST_PAGES} pages"),
])
def test_a_listing_that_fails_or_is_cut_short_is_failed_and_deletes_nothing(tmp_path, answer, why):
    fake = answers("downloads/", answer)
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success", mode="delete", save_db="success")
    assert record["outcome"] == "failed" and fake.deleted() == [] and record["stale"] == []
    assert record["notice"] == f"the listing of downloads/ failed, so nothing was deleted ({why})"
    assert TOKEN not in json.dumps(record) and ACCOUNT not in json.dumps(record)


def test_the_other_prefix_uncounted_never_stops_the_report(tmp_path):
    fake = answers("mirror/", Resp(500, json_data={"success": False, "errors": []}))
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success")
    assert record["outcome"] == "4 stale (reported)" and record["mirror_objects"] is None
    assert record["notice"].endswith("; the objects under mirror/ could not be counted")


def test_it_never_raises(tmp_path, monkeypatch):
    class Broken:
        def list(self, prefix, *, whole=False):
            raise ValueError("odd")

    record = nightly.prune_downloads(Broken(), export_folder(tmp_path), "success", mode="delete", save_db="success")
    assert record["outcome"] == "failed"
    assert record["notice"] == "the check stopped on a fault (ValueError); nothing was deleted"
    # No token in the environment: failed, nothing listed.
    assert nightly.prune_downloads(None, export_folder(tmp_path, name="b"), "success")["outcome"] == "failed"

    def unreadable(folder):
        raise PermissionError("denied")

    monkeypatch.setattr(nightly, "uploaded_names", unreadable)
    record = nightly.prune_downloads(r2(bucket()), tmp_path, "success")
    assert record["notice"] == "the check stopped on a fault (PermissionError); nothing was deleted"


# -- the command ------------------------------------------------------------------------------------


@pytest.fixture
def run(tmp_path, monkeypatch):
    """The command as the workflow runs it: the token and account from the environment, the fake bucket as the
    session."""
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", TOKEN)
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT)

    def go(fake, upload="success", folder=None):
        monkeypatch.setattr(nightly, "_session", lambda: fake)
        out = tmp_path / "out"
        out.mkdir(exist_ok=True)
        (out / nightly.PRUNE_OUTCOME).write_text("failed\n", encoding="utf-8")
        code = nightly.main(["prune-downloads", "--csv", str(folder or export_folder(tmp_path, name="csv-cli")),
                             "--upload-outcome", upload, "--out-dir", str(out), "--bucket", "awardwatch-data"])
        return code, (out / nightly.PRUNE_OUTCOME).read_bytes(), json.loads((out / nightly.PRUNE_SUMMARY).read_text())

    return go


def test_the_command_writes_the_word_and_the_record_and_logs_no_token(run, caplog):
    fake = bucket()
    with caplog.at_level(logging.INFO):
        code, word, record = run(fake)
    assert (code, word) == (0, b"4 stale (reported)\n") and record["notice"] == REPORT and fake.closed
    assert "prune-downloads: 4 stale (reported) (mode report)" in caplog.text
    refusal = Resp(403, json_data={"success": False, "errors": [{"code": 10000, "message": f"bad token {TOKEN}"}]})
    with caplog.at_level(logging.INFO):
        code, word, record = run(answers("downloads/", refusal))
    assert (code, word) == (1, b"failed\n") and TOKEN not in caplog.text and TOKEN not in json.dumps(record)
    code, word, _ = run(bucket(), upload="failure")
    assert (code, word) == (0, b"skipped\n")


def test_the_command_never_lists_without_a_full_upload(run):
    fake = bucket()
    for upload in ("failure", "skipped", ""):
        assert run(fake, upload=upload)[1] == b"skipped\n"
    assert fake.calls == []


# -- the run status -------------------------------------------------------------------------------


def status_with(tmp_path, word, record=None, **kw):
    db = tmp_path / "awardwatch.sqlite"
    if not db.exists():
        connect(db).close()
    return nightly.run_status(db, "2000-01-01T00:00:00Z", {"problems": []}, {"deploy": "success"},
                              downloads_prune=word, downloads_prune_record=record, **kw)


def test_the_status_carries_the_word_and_the_notice_and_only_a_refusal_needs_attention(tmp_path):
    reported = {"outcome": "4 stale (reported)", "notice": REPORT}
    status = status_with(tmp_path, "4 stale (reported)", reported)
    assert status["downloads_prune"] == "4 stale (reported)" and status["ok"] is True
    assert status["notices"] == [{"source": "downloads_prune", "detail": REPORT}]
    assert resilience.attention_items(status) == []
    refused = {"outcome": "refused", "notice": "refused, nothing deleted: tonight's upload sent no file"}
    status = status_with(tmp_path, "refused", refused)
    assert status["ok"] is True
    assert resilience.attention_items(status) == [
        "Old download files in R2: refused, nothing deleted: tonight's upload sent no file"]
    # A word with no record of its own: "failed" gets the fixed notice, the others nothing.
    status = status_with(tmp_path, "failed")
    assert status["notices"] == [{"source": "downloads_prune", "detail": nightly.PRUNE_FAILED_NOTICE}]
    assert resilience.attention_items(status) == []
    for word, record in (("skipped", {"outcome": "skipped", "notice": None}), ("skipped", reported), (None, reported)):
        status = status_with(tmp_path, word, record)
        assert status["notices"] == [] and resilience.attention_items(status) == [], word
    assert status_with(tmp_path, None)["downloads_prune"] == "not run"
    assert resilience.attention_items({"stages": [], "downloads_prune": "refused"}) == [
        "Old download files in R2: refused, nothing deleted"]
    # The bucket not as it was after a removal: an item needing attention, with what the check found.
    alarm = {"outcome": "alarm", "notice": "ALARM, the bucket is not as it was less the files removed: 1 other "
                                           "object gone or changed: awardwatch.sqlite.gz.001"}
    status = status_with(tmp_path, "alarm", alarm)
    assert resilience.attention_items(status) == [f"Old download files in R2: {alarm['notice']}"]
    assert resilience.PRUNE_ALARM == "alarm"


def test_the_status_command_reads_both_files_and_last_run_md_gets_the_word_alone(tmp_path, capsys):
    db = tmp_path / "awardwatch.sqlite"
    connect(db).close()
    folder = tmp_path / "downloads_prune"
    folder.mkdir()
    (folder / nightly.PRUNE_OUTCOME).write_text("4 stale (reported)\n", encoding="utf-8")
    (folder / nightly.PRUNE_SUMMARY).write_text(json.dumps({"outcome": "4 stale (reported)", "notice": REPORT}),
                                                encoding="utf-8")
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(db), "--downloads-prune-outcome", str(folder / nightly.PRUNE_OUTCOME),
                         "--downloads-prune-summary", str(folder / nightly.PRUNE_SUMMARY), "--step", "deploy=success",
                         "--out", str(out)]) == 0
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["downloads_prune"] == "4 stale (reported)"
    written["notices"].append({"source": "buyers", "detail": "a buyer spelling no seed maps"})
    out.write_text(json.dumps(written), encoding="utf-8")
    capsys.readouterr()
    # The notices section of LAST_RUN.md leaves the names out; the workflow writes the word on a line of its own.
    assert nightly.main(["notices", "--status", str(out)]) == 0
    section = capsys.readouterr().out
    assert section == ("Notices from this run (information; nothing failed):\n\n"
                       "- buyers: a buyer spelling no seed maps\n")
    assert "awards-2027" not in section
    # The email and the issue still have them (resilience.notice_items).
    assert any(n.startswith("downloads_prune: report only") for n in resilience.notice_items(written))


# -- the workflow step ---------------------------------------------------------------------------


def step(text, name):
    return text.split(f"- name: {name}", 1)[1].split("\n      - ", 1)[0]


def code(block):
    return "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("#"))


TITLE = "Report or remove the old download files in R2"


def test_the_step_follows_the_upload_takes_its_outcome_and_never_holds_the_run_back():
    text = WORKFLOW.read_text(encoding="utf-8")
    names = re.findall(r"^      - name: (.+)$", text, re.M)
    at = names.index(TITLE)
    assert names[at - 1] == "Save the public files to R2" and at < names.index("Write the run status")
    block = step(text, TITLE)
    lines = [line.strip() for line in code(block).splitlines() if line.strip()]
    assert lines == [
        "id: prune_downloads",
        "if: ${{ !cancelled() }}",
        "continue-on-error: true",
        "timeout-minutes: 5",
        "env:",
        "UPLOAD_OUTCOME: ${{ steps.save_files.outcome }}",
        "SAVE_DB_OUTCOME: ${{ steps.save_db.outcome }}",
        "run: |",
        "out=data/out/downloads_prune",
        'mkdir -p "$out"',
        'echo "failed" > "$out/last_outcome.txt"',
        'python -m awardwatch_pipeline.nightly prune-downloads --csv data/out/csv --upload-outcome "$UPLOAD_OUTCOME" \\',
        '--save-db-outcome "$SAVE_DB_OUTCOME" --out-dir "$out"',
    ]
    # No secret of its own (the job's token and account), no Wrangler, no mode from outside the code.
    assert "secrets." not in block and "WRANGLER" not in block and "--mode" not in block
    # No other step waits on it.
    assert "steps.prune_downloads" not in code(text)
    # The run status reads both files; LAST_RUN.md gets the word on a line of its own and nothing else of it.
    status = step(text, "Write the run status")
    assert "--downloads-prune-outcome data/out/downloads_prune/last_outcome.txt" in status
    assert "--downloads-prune-summary data/out/downloads_prune/summary.json" in status
    record = code(step(text, "Record the run so the schedule stays enabled"))
    assert [line.strip() for line in record.splitlines() if "downloads_prune" in line] == [
        "if [ -f data/out/downloads_prune/last_outcome.txt ]; then",
        'echo "Old download files in R2: $(cat data/out/downloads_prune/last_outcome.txt)" >> LAST_RUN.md',
    ]
    assert nightly.NOT_IN_LAST_RUN == ("downloads_prune",) == (resilience.PRUNE_SOURCE,)
    # Every trigger is still a schedule or a dispatch (site/test/hardening.test.ts holds it too).
    on = text.split("\non:\n", 1)[1].split("\n\n", 1)[0]
    assert re.findall(r"^  (\w+):", on, re.M) == ["schedule", "workflow_dispatch"]


# -- the database and its backups: three checks, each apart from the others -----------------------


# Keys no removal may ever reach, however they came to be asked for: the database and its backups by every name
# the bucket holds, the bucket's other prefixes, paths that climb, and near misses of a download's name.
FORBIDDEN = BACKUPS + NEVER + MIRRORED + [
    "awardwatch.sqlite.gz.003", "awardwatch.sqlite.prev.gz.003", "backups/weekly/db-slot-5.sqlite.gz.002",
    "backups/weekly/d1-slot-6.sql.gz", "backups/weekly/slot-7.txt", "backups/weekly/accounts-slot-1.sql.gz",
    "views/2026-11-01.csv", "views/funnel.csv", "seeds/communications_ocl_cal.zip", "review/awards-persons.txt",
    "intraday/lookup.json.gz", "static.tar.gz.001",
    "downloads/../awardwatch.sqlite.gz.parts", "downloads/../backups/weekly/db-slot-7.sqlite.gz.000",
    "downloads/awards-2027.csv/../../status.json", "downloads//awards-2027.csv", "downloads/./awards-2027.csv",
    "downloads%2Fawards-2027.csv", "downloads/awards-2027.csv?versionId=1", "downloads/awards-2027.csv#x",
    "downloads/awards-2027.csv ", " downloads/awards-2027.csv", "DOWNLOADS/awards-2027.csv", "downloads\\awards-2027.csv",
    "downloads/SHA256SUMS", "downloads/organizations.csv", "downloads/open-tenders.csv", "downloads/awards-backup-2027.csv",
    "downloads/awards-2027.csv.gz", "downloads/awards-2027.sqlite", "/downloads/awards-2027.csv", "downloads", "", "*",
]


def test_the_removal_checks_the_key_itself_and_sends_nothing_for_any_other():
    # Whatever a caller asks, the call refuses before a request leaves: no key but a yearly download file.
    for key in FORBIDDEN + [None, 7, b"downloads/awards-2027.csv", ["downloads/awards-2027.csv"]]:
        fake = bucket()
        before = set(fake.keys)
        with pytest.raises(resilience.R2Error) as caught:
            r2(fake).delete_download(key)
        assert str(caught.value).startswith("refused to remove an object: "), key
        assert fake.calls == [] and fake.keys == before, key
    # The files it is for go through.
    for name in STALE + ["awards-1996.csv", "awards-2040.csv", "contracts-undated.csv", "history-before-2009.csv"]:
        fake = bucket(stale=STALE + [name])
        r2(fake).delete_download(f"downloads/{name}")
        assert fake.deleted() == [f"downloads/{name}"], name


def test_the_choice_and_the_removal_name_the_same_files_by_patterns_written_apart():
    # Two patterns, one in each module, so a mistake in the choice is not a mistake in the removal.
    assert resilience.DELETABLE_KEY_RE.pattern != nightly.YEARLY_DOWNLOAD_RE.pattern
    names = YEARLY + STALE + FIXED + ["SHA256SUMS"] + [k.split("/", 1)[1] for k in NEVER if k.startswith("downloads/") and
                                                        "/" not in k.split("/", 1)[1]] + [
        "awards-1996.csv", "awards-2040.csv", "grants-2019-9.csv", "grants-2019-10.csv", "history-before-2009.csv",
        "contracts-after-2026.csv", "contracts-undated-2.csv", "awards-.csv", "lobbying-2020.csv", "awards-2027.CSV"]
    for name in names:
        chosen = bool(nightly.YEARLY_DOWNLOAD_RE.fullmatch(name))
        removable = resilience.removal_refusal(f"downloads/{name}") is None
        assert chosen == removable, name
    # Every mark of a database, a backup or another prefix refuses, whatever else the key is.
    for mark in resilience.PROTECTED_MARKS:
        assert resilience.removal_refusal(f"downloads/awards-2027{mark}.csv") is not None, mark
    # And the names the bucket's backups carry each hold at least one mark.
    for key in BACKUPS:
        assert any(mark in key for mark in resilience.PROTECTED_MARKS), key


def test_there_is_one_removal_in_the_code_and_no_workflow_removes_an_object():
    assert not hasattr(resilience.R2Rest, "delete") and hasattr(resilience.R2Rest, "delete_download")
    package = ROOT / "pipeline" / "awardwatch_pipeline"
    sends = {p.name: len(re.findall(r"\.delete\(", p.read_text(encoding="utf-8"))) for p in sorted(package.rglob("*.py"))}
    assert {name: n for name, n in sends.items() if n} == {"resilience.py": 1}
    source = (package / "resilience.py").read_text(encoding="utf-8")
    body = source.split("    def delete_download(self, key: str) -> None:", 1)[1].split("\ndef ", 1)[0]
    assert "self.http.delete(" in body and body.index("removal_refusal(key)") < body.index("self.http.delete(")
    # The one caller hands it a name the choice made, under downloads/.
    callers = {p.name: len(re.findall(r"\.delete_download\(", p.read_text(encoding="utf-8"))) for p in sorted(package.rglob("*.py"))}
    assert {name: n for name, n in callers.items() if n} == {"nightly.py": 1}
    assert "r2.delete_download(DOWNLOADS_PREFIX + name)" in (package / "nightly.py").read_text(encoding="utf-8")
    # No workflow removes an object from a bucket, by Wrangler or by the API.
    for path in sorted((ROOT / ".github" / "workflows").glob("*.yml")):
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"object\s+delete|bucket\s+delete|-X\s*DELETE|--request\s+DELETE", text), path.name


@pytest.mark.parametrize("saved", [None, "", "failure", "skipped", "cancelled", "Success", "success "])
def test_a_removal_waits_for_a_night_whose_database_was_saved(tmp_path, saved):
    fake = bucket()
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success", mode="delete", save_db=saved)
    assert record["outcome"] == "refused" and fake.deleted() == [] and fake.listed("") == []
    assert record["notice"] == (
        f"refused, nothing deleted: tonight's database was not saved to R2 (the save step: {saved or 'not run'}), and a "
        "removal waits for a night with a fresh backup; 4 yearly files under downloads/ that tonight's export no longer "
        "writes: awards-2027.csv, awards-2029.csv, grants-2019-3.csv, history-after-2025.csv")
    # A report says what it found whatever the save did: it removes nothing.
    assert nightly.prune_downloads(r2(bucket()), export_folder(tmp_path, name="r"), "success", save_db=saved)[
        "outcome"] == "4 stale (reported)"


@pytest.mark.parametrize("gone,why", [
    (["awardwatch.sqlite.gz.parts"], "its manifest is not in the bucket"),
    (["awardwatch.sqlite.gz.000", "awardwatch.sqlite.gz.001"], "none of its parts is in the bucket"),
    (["awardwatch.sqlite.gz.000", "awardwatch.sqlite.gz.001", "awardwatch.sqlite.gz.parts"], "its manifest is not in the bucket"),
])
def test_a_removal_needs_the_backup_seen_whole_in_the_bucket(tmp_path, gone, why):
    fake = bucket()
    fake.keys -= set(gone)
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success", mode="delete", save_db="success")
    assert record["outcome"] == "refused" and fake.deleted() == []
    assert record["notice"].startswith(f"refused, nothing deleted: the database backup was not seen whole in the bucket ({why}); ")
    # The previous night's set and the weekly snapshots do not stand in for tonight's.
    assert {"awardwatch.sqlite.prev.gz.000", "awardwatch.sqlite.prev.gz.parts"} <= fake.keys


def test_the_bucket_that_cannot_be_listed_before_a_removal_removes_nothing(tmp_path):
    fake = bucket(answers={"": Resp(403, json_data={"success": False, "errors": [{"code": 10000, "message": f"no {TOKEN}"}]})})
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success", mode="delete", save_db="success")
    assert record["outcome"] == "failed" and fake.deleted() == []
    assert record["notice"].startswith("the bucket could not be listed before the removal, so nothing was deleted (")
    assert TOKEN not in json.dumps(record)


def test_another_object_gone_or_changed_after_a_removal_is_an_alarm(tmp_path):
    # The worst case, staged: while the stale files go, a part of the database backup goes too.
    class Careless(FakeBucket):
        def delete(self, url, headers=None, timeout=None, **kwargs):
            self.keys.discard("awardwatch.sqlite.gz.001")
            return super().delete(url, headers=headers, timeout=timeout, **kwargs)

    keys = bucket().keys
    fake = Careless(keys)
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path), "success", mode="delete", save_db="success")
    assert record["outcome"] == "alarm" and len(fake.deleted()) == 4
    assert record["notice"].startswith(
        "ALARM, the bucket is not as it was less the files removed: 1 other object gone or changed: "
        "awardwatch.sqlite.gz.001; deleted 4 yearly files under downloads/")
    # An object whose bytes changed (its size, or its etag alone) is seen as well, and so is a download not named.
    for key, change in (("backups/weekly/db-slot-7.sqlite.gz.000", "size"), ("status.json", "etag"),
                        ("downloads/organizations.csv", "gone")):
        class Changing(FakeBucket):
            def delete(self, url, headers=None, timeout=None, **kwargs):
                if change == "size":
                    self.sizes[key] = 11
                elif change == "etag":
                    self.etags[key] = "e2"
                else:
                    self.keys.discard(key)
                return super().delete(url, headers=headers, timeout=timeout, **kwargs)

        fake = Changing(bucket().keys)
        record = nightly.prune_downloads(r2(fake), export_folder(tmp_path, name=f"csv-{change}"), "success", mode="delete",
                                         save_db="success")
        assert record["outcome"] == "alarm" and f"1 other object gone or changed: {key}" in record["notice"], key
    # The bucket that cannot be listed after is an alarm too: the check did not happen.
    class Blind(FakeBucket):
        def get(self, url, headers=None, timeout=None, stream=False, **kwargs):
            if "prefix=" not in url and self.deleted():
                return Resp(500)
            return super().get(url, headers=headers, timeout=timeout, stream=stream, **kwargs)

    fake = Blind(bucket().keys)
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path, name="blind"), "success", mode="delete", save_db="success")
    assert record["outcome"] == "alarm" and "the bucket could not be listed after the removal" in record["notice"]
    # A new object that appears meanwhile is not a change to anything held.
    class Growing(FakeBucket):
        def delete(self, url, headers=None, timeout=None, **kwargs):
            self.keys.add("views/2026-11-21.csv")
            return super().delete(url, headers=headers, timeout=timeout, **kwargs)

    fake = Growing(bucket().keys)
    record = nightly.prune_downloads(r2(fake), export_folder(tmp_path, name="growing"), "success", mode="delete", save_db="success")
    assert record["outcome"] == "4 deleted"


def test_the_inventory_helpers():
    listing = [{"key": "a", "size": 1, "etag": "x"}, {"key": "b", "size": 2}, {"nokey": 1}, "junk", {"key": 5}]
    assert resilience.inventory(listing) == {"a": (1, "x"), "b": (2, None)}
    assert resilience.inventory(None) == {}
    before = {"a": (1, "x"), "b": (2, None), "c": (3, "z")}
    assert resilience.changed_objects(before, before, set()) == []
    assert resilience.changed_objects(before, {"a": (1, "x"), "c": (3, "y")}, {"b"}) == ["c"]
    assert resilience.changed_objects(before, {"a": (1, "x")}, {"b"}) == ["c"]
    assert resilience.changed_objects(before, {**before, "d": (4, "n")}, None) == []
    assert resilience.backup_missing({"awardwatch.sqlite.gz.parts": 1, "awardwatch.sqlite.gz.000": 1}, "awardwatch.sqlite.gz") is None
    assert resilience.backup_missing({"awardwatch.sqlite.gz.parts": 1, "awardwatch.sqlite.prev.gz.000": 1},
                                     "awardwatch.sqlite.gz") == "none of its parts is in the bucket"
    assert resilience.backup_missing({"awardwatch.sqlite.gz.000": 1}, "awardwatch.sqlite.gz") == "its manifest is not in the bucket"
    assert (nightly.BACKUP, nightly.PARTS_SUFFIX) == ("awardwatch.sqlite.gz", ".parts")


# -- R2Rest: the removal and the whole listing ---------------------------------------------------


def test_the_removal_goes_to_the_object_with_the_token_in_the_header_only():
    fake = bucket()
    r2(fake).delete_download("downloads/awards-2027.csv")
    [(method, url, headers)] = fake.calls
    assert method == "DELETE" and url == f"https://api.cloudflare.com{OBJECTS}/downloads/awards-2027.csv"
    assert headers["Authorization"] == f"Bearer {TOKEN}" and TOKEN not in url

    class Answers:
        def __init__(self, answer):
            self.answer = answer

        def delete(self, url, headers=None, timeout=None, **kwargs):
            if isinstance(self.answer, Exception):
                raise self.answer
            return self.answer

    resilience.R2Rest(Answers(Resp(204)), ACCOUNT, TOKEN, "awardwatch-data").delete_download("downloads/awards-2027.csv")
    for answer, why in ((Resp(404, json_data={"errors": [{"code": 10007, "message": f"gone {TOKEN}"}]}),
                         "the removal of downloads/awards-2027.csv answered HTTP 404 (10007 gone [token])"),
                        (Resp(500), "the removal of downloads/awards-2027.csv answered HTTP 500"),
                        (ConnectionError(f"reset {TOKEN} {ACCOUNT}"),
                         "the removal of downloads/awards-2027.csv failed (ConnectionError: reset [token] [token])")):
        with pytest.raises(resilience.R2Error) as caught:
            resilience.R2Rest(Answers(answer), ACCOUNT, TOKEN, "awardwatch-data").delete_download("downloads/awards-2027.csv")
        assert str(caught.value) == why


def test_a_listing_cut_short_is_an_error_only_when_the_whole_list_is_asked_for():
    cut = Resp(200, json_data={"success": True, "result": [{"key": "backups/weekly/db-slot-1.sqlite.gz"}],
                               "result_info": {"is_truncated": True}})
    fake = bucket(answers={"backups/weekly/db-slot-": cut, "downloads/": cut})
    # The weekly restore keeps its reading.
    assert r2(fake).list("backups/weekly/db-slot-") == [{"key": "backups/weekly/db-slot-1.sqlite.gz"}]
    with pytest.raises(resilience.R2Error, match="cut short"):
        r2(fake).list("downloads/", whole=True)
