"""The records database's sync (records_db.py, docs/analytics.md): the rows against the
counting rules (independently of the sync, through the figures the buyer pages already
show), the fiscal years, the segment rows, the people left out, the ledger and the
stage, the batches applied to a real SQLite database built from records_schema.sql,
the count check, the three commands, the workflow step and its drift guards."""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, config, nightly, resilience
from awardwatch_pipeline import records_db as rd
from awardwatch_pipeline.db import connect, get_meta, set_meta
from export_seed import ACME, NORTH, STAMP, seed

REPO = Path(__file__).resolve().parents[2]
WORKFLOW = REPO / ".github" / "workflows" / "nightly.yml"
WRANGLER = REPO / "site" / "wrangler.jsonc"


@pytest.fixture
def seeded(conn):
    ids = seed(conn)
    # The export writes the data date; finish.sql carries it to D1.
    set_meta(conn, "data_as_of", "2026-10-31")
    return conn, ids


def d1() -> sqlite3.Connection:
    """A stand-in for the D1 database: SQLite with the records schema applied."""
    db = sqlite3.connect(":memory:")
    db.executescript(rd.SCHEMA_PATH.read_text(encoding="utf-8"))
    return db


def apply(db: sqlite3.Connection, out: Path, manifest: dict) -> None:
    for name in manifest["batches"]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    db.commit()


def counts(db: sqlite3.Connection) -> dict[str, int]:
    return dict(zip((t.name for t in rd.TABLES), db.execute(rd.COUNT_SQL).fetchone()))


def night(conn: sqlite3.Connection, out: Path, db: sqlite3.Connection, **kwargs) -> dict:
    """records-sync, the apply, the count check, finish.sql and records-synced, as the workflow runs them."""
    manifest = rd.sync(conn, out, **kwargs)
    apply(db, out, manifest)
    assert rd.count_check(rd.expected_counts(manifest), counts(db)) is None
    db.executescript((out / rd.FINISH).read_text(encoding="utf-8"))
    rd.record_sync(conn, manifest)
    return manifest


def rows_by_key(conn: sqlite3.Connection) -> dict[int, tuple]:
    return {r[0]: r for r in rd.record_rows(conn)}


# -- keys, numbers and fiscal years ----------------------------------------------


def test_fiscal_years_run_april_to_march_named_by_their_first_year():
    assert rd.fiscal("2025-04-01") == (2025, 1)
    assert rd.fiscal("2025-06-30") == (2025, 1)
    assert rd.fiscal("2025-07-01") == (2025, 2)
    assert rd.fiscal("2025-12-31T23:59:00") == (2025, 3)
    assert rd.fiscal("2026-01-01") == (2025, 4)
    assert rd.fiscal("2026-03-31") == (2025, 4)
    for blank in (None, "", "2026", "31/03/2026", "2026-13-01"):
        assert rd.fiscal(blank) == (None, None), blank


def test_numbers_read_back_and_fit_where_they_go():
    assert rd.org_number("org-00000000ff") == 255 and rd.org_id(255) == "org-00000000ff"
    assert rd.org_number("org-ffffffffff") == 2 ** 40 - 1 < 2 ** 53
    for bad in (None, "org-FFFFFFFFFF", "org-123", "dnd-mdn", 7):
        assert rd.org_number(bad) is None, bad
    # 40 bits, so the site's JavaScript reads a buyer's number exactly.
    assert 0 <= rd.buyer_number("dnd-mdn") < 2 ** 40 and rd.buyer_number("dnd-mdn") != rd.buyer_number("pwgsc-tpsgc")
    key = rd.key_of("award:AW-1")
    assert -(2 ** 63) <= key < 2 ** 63 and key == rd.key_of("award:AW-1") != rd.key_of("award:AW-1#72")


def test_methods_become_the_tbs_codes():
    assert rd.method_code("Competitive - Open bidding") == "OB"
    assert rd.method_code("Competitive - Selective tendering") == "ST"
    assert rd.method_code("Competitive - Traditional") == "TC"
    assert rd.method_code("Non-competitive") == "TN"
    assert rd.method_code("Advance contract award notice") == "AC"
    assert rd.method_code("tn") == "TN" and rd.method_code(" OB ") == "OB"
    for none in (None, "", "Competitive - Limited tendering", "XX"):
        assert rd.method_code(none) is None, none


# -- the rows against the counting rules -------------------------------------------


def test_each_record_counts_once_with_the_buyer_pages_figures(seeded):
    """Independent of the sync: every buyer and source adds up to the yearly figures
    indicators.compute wrote for the buyer pages (calendar years there, fiscal here, so
    the whole span is compared), counted once whatever its segments."""
    conn, _ = seeded
    names = {rd.buyer_number(b): b for (b,) in conn.execute("SELECT id FROM buyers")}
    mine: dict[tuple[str, str], list] = {}
    for _k, src, _fy, _fq, bid, _oid, _sid, extra, cents, _vnote, _comp, _meth in rd.record_rows(conn):
        if extra:
            continue
        cell = mine.setdefault((names[bid], {v: k for k, v in rd.SOURCES.items()}[src]), [0, None])
        cell[0] += 1
        if cents is not None:
            cell[1] = (cell[1] or 0) + cents
    theirs = {(b, s): [n, round(t * 100) if t is not None else None] for b, s, n, t in conn.execute(
        "SELECT buyer_id, source, SUM(n), SUM(total) FROM buyer_years GROUP BY buyer_id, source")}
    assert mine == theirs and theirs


def test_values_are_cents_and_the_reason_a_value_is_left_out(seeded):
    conn, ids = seeded
    by = rows_by_key(conn)
    award = lambda ref: by[rd.key_of(f"award:{ref}")]  # noqa: E731
    cents, vnote = 8, 9
    # The newest amendment's total; a cancelled notice counts zero; another currency is left out.
    assert (award("AW-1")[cents], award("AW-1")[vnote]) == (125_000_000, rd.COUNTED)
    assert (award("AW-3")[cents], award("AW-3")[vnote]) == (0, rd.COUNTED)
    assert (award("AW-4")[cents], award("AW-4")[vnote]) == (None, rd.OTHER_CURRENCY)
    # A published contract row's own value: the amendment row adds its amendment.
    contract = by[rd.key_of("contract:dnd-mdn:C-2")]
    assert contract[cents] == 3_000_000 and contract[10:] == (0, "TN")
    # A value flagged for checking, and one the source did not publish.
    conn.execute("INSERT INTO value_flags (kind, key, rule, computed_at) VALUES ('award', 'AW-2', 'other_source', ?)", (STAMP,))
    conn.execute("UPDATE awards SET amount = NULL, total_value = NULL WHERE reference = 'AW-1'")
    by = rows_by_key(conn)
    assert (award("AW-2")[cents], award("AW-2")[vnote]) == (None, rd.FLAGGED)
    assert (award("AW-1")[cents], award("AW-1")[vnote]) == (None, rd.NO_VALUE)
    # The organization's number reads back as its id.
    assert rd.org_id(award("AW-2")[5]) == ids[NORTH] and rd.org_id(award("AW-1")[5]) == ids[ACME]


def test_history_counts_under_its_client_and_a_withheld_supplier_names_no_one(seeded):
    conn, _ = seeded
    by = rows_by_key(conn)
    for ref in ("H-1", "H-2"):
        assert by[rd.key_of(f"history:{ref}")][4] == rd.buyer_number("dnd-mdn"), ref
    assert by[rd.key_of("history:H-2")][5] is None
    assert by[rd.key_of("award:AW-5")][5] is None


def test_a_notice_counts_once_and_in_each_of_its_segments(seeded):
    conn, _ = seeded
    conn.execute("INSERT INTO award_codes (reference, amendment, unspsc) VALUES ('AW-1', 1, '43211500'), "
                 "('AW-1', 1, '72101599'), ('AW-1', 1, '99999999')")
    rows = [r for r in rd.record_rows(conn) if r[0] in (rd.key_of("award:AW-1"), rd.key_of("award:AW-1#72"),
                                                        rd.key_of("award:AW-1#43"))]
    # Its own row under the lowest segment, one extra row for the other; a code outside the 57 segments is no segment.
    assert sorted((r[6], r[7]) for r in rows) == [(43, 0), (72, 1)]
    assert {r[8] for r in rows} == {125_000_000}
    # Published contracts and grants carry no segment.
    assert all(r[6] is None for r in rd.record_rows(conn) if r[1] in (3, 4))


def test_grants_to_people_are_never_in_the_database(seeded):
    conn, _ = seeded
    conn.execute(
        "INSERT INTO grants (owner_org, reference, amendment, agreement_type, recipient_type, recipient_withheld, value, "
        "start, buyer_id, loaded_at) VALUES ('dnd-mdn', 'G-P', 0, 'G', 'O', 1, 5000, '2026-05-01', 'dnd-mdn', ?)", (STAMP,))
    tally = rd._Counts()
    keys = {r[0] for r in rd.record_rows(conn, tally)}
    assert rd.key_of("grant:dnd-mdn:G-P") not in keys and rd.key_of("grant:dnd-mdn:G-1") in keys
    assert tally.grants_withheld == 1


# -- the sync ------------------------------------------------------------------------


def test_the_first_sync_loads_everything_and_the_next_sends_only_changes(seeded, tmp_path):
    conn, ids = seeded
    out = tmp_path / "records"
    db = d1()
    first = night(conn, out, db)
    assert first["full"] and first["reason"].startswith("first load")
    assert counts(db) == first["expected"] and first["expected"]["records"] == 11
    assert dict(db.execute("SELECT key, value FROM rec_meta")) == {"state": "ready", "as_of": "2026-10-31", "rules": "2"}
    # The summary tables hold what the records add up to.
    assert db.execute("SELECT SUM(n), SUM(cents) FROM rec_buyer_quarters").fetchone() == \
        db.execute("SELECT COUNT(*), SUM(cents) FROM records WHERE extra = 0 AND bid IS NOT NULL AND fy IS NOT NULL").fetchone()
    assert db.execute("SELECT name FROM rec_orgs WHERE oid = ?", (rd.org_number(ids[ACME]),)).fetchone() == (ACME,)
    assert db.execute("SELECT id, name_fr FROM rec_buyers WHERE bid = ?", (rd.buyer_number("dnd-mdn"),)).fetchone() == \
        ("dnd-mdn", "Défense nationale")
    assert conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0] == first["expected_total"]
    assert conn.execute("SELECT COUNT(*) FROM records_staged").fetchone()[0] == 0

    second = night(conn, out, db)
    assert not second["full"] and second["batches"] == [] and sum(second["upserts"].values()) == 0

    # One value changes and one record goes: one row and the sums around it are sent, one row is deleted.
    conn.execute("UPDATE contracts SET amendment_value = 40000 WHERE reference = 'C-2'")
    conn.execute("DELETE FROM grants WHERE reference = 'G-1'")
    third = night(conn, out, db)
    assert third["upserts"]["records"] == 1 and third["deletes"]["records"] == 1
    assert third["upserts"]["rec_buyer_quarters"] == 1 and third["deletes"]["rec_buyer_quarters"] == 1
    assert db.execute("SELECT cents FROM records WHERE k = ?", (rd.key_of("contract:dnd-mdn:C-2"),)).fetchone() == (4_000_000,)
    assert db.execute("SELECT COUNT(*) FROM records WHERE src = 4").fetchone() == (0,)
    assert counts(db) == third["expected"]


def test_batches_applied_twice_change_nothing(seeded, tmp_path):
    conn, _ = seeded
    out = tmp_path / "records"
    db = d1()
    manifest = rd.sync(conn, out)
    apply(db, out, manifest)
    before = [db.execute(f"SELECT * FROM {t.name} ORDER BY 1").fetchall() for t in rd.TABLES]
    # A full reload's batch starts from scratch, so applying it again must leave the same rows.
    apply(db, out, manifest)
    assert [db.execute(f"SELECT * FROM {t.name} ORDER BY 1").fetchall() for t in rd.TABLES] == before
    # The upserts alone, applied again, change nothing either.
    for name in manifest["batches"][1:]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    assert [db.execute(f"SELECT * FROM {t.name} ORDER BY 1").fetchall() for t in rd.TABLES] == before


def test_a_full_reload_marks_the_database_loading_until_finish(seeded, tmp_path):
    conn, _ = seeded
    out = tmp_path / "records"
    db = d1()
    night(conn, out, db)
    manifest = rd.sync(conn, out, full=True)
    assert manifest["full"] and manifest["reason"] == "requested"
    db.executescript((out / manifest["batches"][0]).read_text(encoding="utf-8"))
    assert db.execute("SELECT value FROM rec_meta WHERE key = 'state'").fetchone() == ("loading",)
    assert counts(db)["records"] == 0
    for name in manifest["batches"][1:]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    db.executescript((out / rd.FINISH).read_text(encoding="utf-8"))
    assert db.execute("SELECT value FROM rec_meta WHERE key = 'state'").fetchone() == ("ready",)
    rd.record_sync(conn, manifest)
    assert conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0] == manifest["expected_total"]


def test_a_full_reload_after_a_count_mismatch_waits_its_days(conn):
    assert rd.full_reason(conn, ledger_empty=True, today="2026-11-01").startswith("first load")
    set_meta(conn, rd.META_FULL_AT, "2026-11-01")
    rd.request_reload(conn, "2026-11-10")
    assert rd.full_reason(conn, today="2026-11-10") == ""
    assert rd.full_reason(conn, today="2026-11-29").startswith("the row counts read back")
    assert rd.full_reason(conn, requested=True, today="2026-11-02") == "requested"


def test_the_ledger_records_only_the_plan_it_staged(seeded, tmp_path):
    conn, _ = seeded
    out = tmp_path / "records"
    old = rd.sync(conn, out)
    rd.sync(conn, out)
    with pytest.raises(ValueError, match="not the one staged"):
        rd.record_sync(conn, old)
    assert conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0] == 0


def test_statements_and_batches_respect_their_caps(seeded, tmp_path):
    conn, _ = seeded
    out = tmp_path / "records"
    rd.build(conn)
    rd.stage(conn, "requested")
    # Every row staged, without the reset batch (whose schema is one statement of its own).
    writer = rd.write_batches(conn, out, full=False, max_bytes=2_000, max_rows_per_upsert=3, max_statement_bytes=1_000)
    assert len(writer.files) > 3
    for name in writer.files:
        data = (out / name).read_bytes()
        assert len(data) <= 2_000
        for statement in data.decode("utf-8").splitlines():
            assert len(statement.encode("utf-8")) <= 1_000 and statement.count("), (") <= 2
    with pytest.raises(ValueError, match="NUL"):
        list(rd.upsert_statements(rd.ORGS, [(1, "A\x00B")]))
    with pytest.raises(ValueError, match="not a date"):
        rd.finish_sql("2026-11-04'); DROP TABLE records; --")


def test_the_schema_applies_twice_unchanged_and_names_only_its_tables():
    db = d1()
    db.executescript(rd.SCHEMA_PATH.read_text(encoding="utf-8"))
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert tables == {t.name for t in rd.TABLES} | {"rec_meta"}
    # Every table the sync writes has the columns it writes.
    for t in rd.TABLES:
        assert [r[1] for r in db.execute(f"PRAGMA table_info({t.name})")] == list(t.written), t.name


# -- the commands and the run ------------------------------------------------------------


def test_the_parser_names_the_three_commands():
    parser = cli.build_parser()
    args = parser.parse_args(["records-sync", "--db", "x.sqlite", "--full"])
    assert args.command == "records-sync" and args.full
    assert parser.parse_args(["records-check", "--manifest", "m", "--counts", "c"]).db is None
    assert parser.parse_args(["records-synced", "--manifest", "m"]).command == "records-synced"


def test_the_commands_run_a_night_end_to_end(tmp_path):
    path = tmp_path / "awardwatch.sqlite"
    conn = connect(path)
    seed(conn)
    set_meta(conn, "data_as_of", "2026-10-31")
    conn.commit()
    conn.close()
    out = tmp_path / "records"
    outcome = config.OUT_DIR / "records" / rd.OUTCOME
    db = d1()

    assert cli.main(["records-sync", "--db", str(path), "--out", str(out)]) == 0
    assert outcome.read_text() == "failed\n"
    manifest = json.loads((out / rd.MANIFEST).read_text(encoding="utf-8"))
    for name in (out / rd.BATCH_LIST).read_text().split():
        db.executescript((out / name).read_text(encoding="utf-8"))

    wrong = tmp_path / "wrong.json"
    answer = counts(db)
    wrong.write_text(json.dumps([{"results": [{**answer, "records": answer["records"] - 1}], "success": True}]))
    assert cli.main(["records-check", "--manifest", str(out / rd.MANIFEST), "--counts", str(wrong), "--db", str(path)]) == 1
    conn = connect(path)
    assert get_meta(conn, rd.META_RELOAD)
    conn.close()

    right = tmp_path / "count.json"
    right.write_text("Wrangler says hello\n" + json.dumps([{"results": [answer], "success": True}]))
    assert cli.main(["records-check", "--manifest", str(out / rd.MANIFEST), "--counts", str(right)]) == 0
    assert cli.main(["records-synced", "--db", str(path), "--manifest", str(out / rd.MANIFEST)]) == 0
    assert outcome.read_text() == "synced\n"
    conn = connect(path)
    assert conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0] == manifest["expected_total"]
    assert get_meta(conn, rd.META_RELOAD) is None and get_meta(conn, rd.META_PLAN) is None
    log_rows = conn.execute("SELECT rows, full FROM records_sync").fetchall()
    assert [tuple(r) for r in log_rows] == [(manifest["expected_total"], 1)]
    conn.close()

    # The next night: nothing to send, though finish.sql still moves the data date.
    assert cli.main(["records-sync", "--db", str(path), "--out", str(out)]) == 0
    assert json.loads((out / rd.MANIFEST).read_text())["batches"] == []
    assert "('as_of', '2026-10-31')" in (out / rd.FINISH).read_text()
    assert cli.main(["records-synced", "--db", str(path), "--manifest", str(out / rd.MANIFEST)]) == 0
    assert outcome.read_text() == "nothing to send\n"

    # A sync that cannot read the database stops with exit 2 and leaves "failed", and no manifest.
    (tmp_path / "broken.sqlite").write_bytes(b"not a database")
    assert cli.main(["records-sync", "--db", str(tmp_path / "broken.sqlite"), "--out", str(out)]) == 2
    assert outcome.read_text() == "failed\n"


@pytest.mark.parametrize(("value", "item", "notice"), [
    ("failed", True, False), ("synced", False, False), ("nothing to send", False, False), ("no database", False, True),
])
def test_the_outcome_reaches_the_status_and_only_a_failure_needs_attention(tmp_path, value, item, notice):
    db = tmp_path / "awardwatch.sqlite"
    connect(db).close()
    started = tmp_path / "started.txt"
    started.write_text("2026-11-01T00:00:00Z")
    outcome = tmp_path / "records" / rd.OUTCOME
    outcome.parent.mkdir()
    outcome.write_text(value + "\n")
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(db), "--started-file", str(started), "--records-outcome", str(outcome),
                         "--step", "deploy=success", "--out", str(out)]) == 0
    status = json.loads(out.read_text())
    assert status["records_sync"] == value and status["ok"] is True
    assert ("Records database sync: failed (sent again next run)" in resilience.attention_items(status)) is item
    assert any(n["source"] == "records_sync" for n in status["notices"]) is notice


# -- the workflow and the drift guards ----------------------------------------------------


def step(text: str, name: str) -> str:
    return text.split(f"- name: {name}", 1)[1].split("\n      - ", 1)[0]


def test_the_workflow_syncs_the_records_database_before_the_save_and_never_holds_the_deploy_back():
    text = WORKFLOW.read_text(encoding="utf-8")
    names = [line.strip()[len("- name: "):] for line in text.splitlines() if line.strip().startswith("- name: ")]
    at = names.index("Sync the records database")
    assert names[at - 1] == "Sync the search database" and names[at + 1] == "Bundle the static data for the site"
    assert at < names.index("Deploy the Worker with the new data as assets") < names.index("Save the database to R2")
    sync = step(text, "Sync the records database")
    assert "id: records" in sync and "continue-on-error: true" in sync and "timeout-minutes: 150" in sync
    assert "steps.verify.outputs.export_ok == 'true' && steps.verify.outputs.db_ok == 'true'" in sync
    # The placeholder first (no database: a notice, nothing sent), then plan, schema, batches, counts, check,
    # finish and ledger, in that order.
    order = [
        "if grep -q '\"database_id\": \"00000000-0000-0000-0000-000000000000\"' wrangler.jsonc; then",
        "printf 'no database\\n' > \"$out/last_outcome.txt\"",
        'awardwatch_pipeline records-sync --db ../data/awardwatch.sqlite --out "$out"',
        '"$WRANGLER" d1 execute awardwatch-records --remote --yes --file ../pipeline/records_schema.sql',
        'for batch in $(cat "$out/batches.txt"); do',
        '"$WRANGLER" d1 execute awardwatch-records --remote --yes --file "$out/$batch"',
        f'"$WRANGLER" d1 execute awardwatch-records --remote --json --command "{rd.COUNT_SQL}" > "$out/count.json"',
        'records-check --db ../data/awardwatch.sqlite --manifest "$out/manifest.json" --counts "$out/count.json"',
        '"$WRANGLER" d1 execute awardwatch-records --remote --yes --file "$out/finish.sql"',
        'records-synced --db ../data/awardwatch.sqlite --manifest "$out/manifest.json"',
    ]
    places = [sync.index(line) for line in order]
    assert places == sorted(places)
    for name in ("Bundle the static data for the site", "Deploy the Worker with the new data as assets",
                 "Save the database to R2"):
        assert "steps.records." not in step(text, name), name
    assert "--records-outcome data/out/records/last_outcome.txt" in step(text, "Write the run status")
    assert 'echo "Records database: $(cat data/out/records/last_outcome.txt)"' in step(
        text, "Record the run so the schedule stays enabled")


def test_the_binding_the_site_reads_is_the_database_the_step_writes():
    wrangler = WRANGLER.read_text(encoding="utf-8")
    binding = re.search(r'"binding": "RECORDS",\s*"database_name": "([a-z-]+)",\s*"database_id": "([0-9a-f-]{36})"', wrangler)
    assert binding and binding.group(1) == "awardwatch-records"
    # Either the placeholder the step looks for or a real id; never another database's.
    others = set(re.findall(r'"database_id": "([0-9a-f-]{36})"', wrangler)) - {binding.group(2)}
    assert binding.group(2) not in others and len(others) == 3
    text = WORKFLOW.read_text(encoding="utf-8")
    assert text.count("d1 execute awardwatch-records") == 4
    # The local database gets the schema with the others.
    scripts = json.loads((REPO / "site" / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert "wrangler d1 execute awardwatch-records --local --file=../pipeline/records_schema.sql" in scripts["db:local"]


def test_the_site_reads_the_numbers_the_sync_writes():
    ts = (REPO / "site" / "src" / "records_db.ts").read_text(encoding="utf-8")
    numbers = re.search(r"export const SOURCE_NUMBER[^=]*=\s*\{([^}]*)\}", ts)
    assert numbers and dict(re.findall(r"(\w+): (\d)", numbers.group(1))) == {k: str(v) for k, v in rd.SOURCES.items()}
    # Every table and column the site names is one the schema creates.
    db = d1()
    columns = {t: {r[1] for r in db.execute(f"PRAGMA table_info({t})")} for t in [t.name for t in rd.TABLES] + ["rec_meta"]}
    for table in set(re.findall(r"\b(?:FROM|JOIN) (rec_\w+|records)\b", ts)):
        assert table in columns, table
