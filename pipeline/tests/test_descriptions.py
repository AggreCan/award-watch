"""CanadaBuys descriptions: how much of each is kept, the cut at a whole word, the cut each row records, the
first run after a change to the rule, and the mark the export passes to the site.

The fixtures are the 2026-10-31 rows test_canadabuys.py reads; two of the tender notices run past 10,000
characters and fifteen past 600.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import sqlite3
from datetime import datetime, timezone

import pytest

from conftest import FakeResponse
from awardwatch_pipeline import export_static as es
from awardwatch_pipeline.db import connect, get_meta
from awardwatch_pipeline.http import PoliteClient
from awardwatch_pipeline.sources import canadabuys, canadabuys_rows
from awardwatch_pipeline.sources.canadabuys_rows import (
    DESCRIPTION_MAX, TENDER_DESCRIPTION_MAX, UNMARKED_DESCRIPTION_MAX, description,
)
from export_seed import TODAY, award, seed, tender

csv.field_size_limit(2**31 - 1)
FILES = {"tenders": "canadabuys_tenders_new.csv", "awards": "canadabuys_awards.csv", "history": "canadabuys_history.csv"}
DESC = {"tenders": "tenderDescription-descriptionAppelOffres-eng", "awards": "awardDescription-descriptionAttribution-eng"}
DESC_FR = {"tenders": "tenderDescription-descriptionAppelOffres-fra", "awards": "awardDescription-descriptionAttribution-fra"}
REF = "referenceNumber-numeroReference"
AMD = "amendmentNumber-numeroModification"
WORDS = "The work includes mechanical systems for the ablutions building and related site services. "
# What a name the person test withholds becomes in the free text, in either language.
REDACTED = ("[name withheld]", "[nom retiré]")


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        return reader.fieldnames, list(reader)


def by_version(rows, column):
    """A file's text in a column for each version, as the loader keys and normalizes it."""
    return {(r[REF].strip(), int(r[AMD] or 0)): normalized(r[column]) for r in rows}


def csv_bytes(header, rows) -> bytes:
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=header, quoting=csv.QUOTE_ALL, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return ("﻿" + buf.getvalue()).encode("utf-8")


def normalized(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


# -- the cut ---------------------------------------------------------------------------


def test_a_text_that_fits_is_kept_whole_and_says_so():
    assert description("  Hull inspection.\r\n\r\nAnd repair. ", 600) == ("Hull inspection.\n\nAnd repair.", 0)
    assert description("x" * 600, 600) == ("x" * 600, 0)
    for blank in ("", "   ", None):
        assert description(blank, 600) == (None, None)


def test_a_longer_text_ends_at_its_last_whole_word_within_the_limit():
    text = ("Note: " + WORDS * 20).strip()
    assert text[599:601] == "lu"  # the limit falls inside "ablutions"
    kept, cut = description(text, 600)
    assert cut == 600 and 550 < len(kept) < 600
    # The text stops before a space: its last word is whole, and the word the limit fell in is left out.
    assert text.startswith(kept) and text[len(kept)] == " " and not kept.endswith(" ")
    assert kept.split() == text.split()[:len(kept.split())] and kept.endswith(" the")


def test_a_limit_that_falls_on_a_space_keeps_the_word_before_it():
    text = "a" * 599 + " next words"
    assert description(text, 599) == ("a" * 599, 599)
    assert description("ab " * 300, 600) == (("ab " * 200).rstrip(), 600)


def test_a_start_without_a_space_in_its_second_half_is_cut_at_the_limit():
    link = "Documents: https://canadabuys.canada.ca/" + "a" * 2000
    kept, cut = description(link, 600)
    assert (kept, cut) == (link[:600], 600)


def test_a_run_of_spaces_across_the_limit_leaves_the_words_before_it():
    text = "start " + " " * 50_000 + "end " * 10
    kept, cut = description(text, TENDER_DESCRIPTION_MAX)
    assert cut == TENDER_DESCRIPTION_MAX and kept == "start"


def test_each_table_keeps_its_own_figure():
    assert canadabuys_rows.DESCRIPTION_MAX_BY_STAGE == {"tenders": TENDER_DESCRIPTION_MAX, "awards": DESCRIPTION_MAX,
                                                        "history": DESCRIPTION_MAX}
    assert TENDER_DESCRIPTION_MAX == 10_000 and DESCRIPTION_MAX == 600 and UNMARKED_DESCRIPTION_MAX == 600
    text = WORDS * 200
    row = {"description_en": text, "description_fr": "Court."}
    get = lambda f: row.get(f, "")  # noqa: E731
    tender_rec, _, _ = canadabuys_rows.common_fields(get)
    award_rec, _, _ = canadabuys_rows.common_fields(get, "awards")
    assert tender_rec["description_en_cut"] == TENDER_DESCRIPTION_MAX and len(tender_rec["description_en"]) > 9_900
    assert award_rec["description_en_cut"] == DESCRIPTION_MAX and len(award_rec["description_en"]) <= 600
    assert tender_rec["description_fr"] == award_rec["description_fr"] == "Court."
    assert tender_rec["description_fr_cut"] == award_rec["description_fr_cut"] == 0
    empty, _, _ = canadabuys_rows.common_fields(lambda f: "")
    assert empty["description_en"] is None and empty["description_en_cut"] is None


@pytest.mark.parametrize("stage", ["tenders", "awards", "history"])
def test_every_row_a_file_loads_records_its_cut(conn, fixtures, stage):
    canadabuys.load_file(conn, stage, fixtures / FILES[stage], "f.csv", now="2026-11-10T13:00:00Z")
    limit = canadabuys_rows.DESCRIPTION_MAX_BY_STAGE[stage]
    _, rows = read_csv(fixtures / FILES[stage])
    table = canadabuys.TABLES[stage]
    checked = 0
    for lang in ("en", "fr"):
        source = by_version(rows, canadabuys_rows.COLUMNS[stage][f"description_{lang}"])
        stored = conn.execute(f"SELECT reference, amendment, description_{lang} AS text, description_{lang}_cut AS cut "
                              f"FROM {table}").fetchall()
        for r in stored:
            whole = source[(r["reference"], r["amendment"])]
            if r["text"] and any(mark in r["text"] for mark in REDACTED):
                continue  # a withheld name replaced: the redaction test below reads these
            checked += 1
            if not whole:
                assert r["text"] is None and r["cut"] is None
            elif len(whole) <= limit:
                assert (r["text"], r["cut"]) == (whole, 0)
            else:
                assert r["cut"] == limit and whole.startswith(r["text"]) and len(r["text"]) <= limit
                assert whole[len(r["text"])].isspace()
    assert checked > 40


def test_a_tender_notice_keeps_ten_thousand_characters(conn, fixtures):
    canadabuys.load_file(conn, "tenders", fixtures / FILES["tenders"], "f.csv", now="2026-11-10T13:00:00Z")
    cut = conn.execute("SELECT COUNT(*) FROM tenders WHERE description_en_cut = ?", (TENDER_DESCRIPTION_MAX,)).fetchone()[0]
    whole_long = conn.execute("SELECT COUNT(*) FROM tenders WHERE description_en_cut = 0 "
                              "AND length(description_en) > 600").fetchone()[0]
    # Two notices run past 10,000 characters; the others past 600 are now whole.
    assert cut == 2 and whole_long == 13


def test_a_redacted_description_records_the_cut_of_the_redacted_text(conn, fixtures, tmp_path):
    # The fixture's award row whose supplier reads as a person (its name is read from the file, never written here).
    header, rows = read_csv(fixtures / FILES["awards"])
    row = dict(next(r for r in rows if r[REF] == "cb-000-00000001"))
    name = row["supplierLegalName-nomLegalFournisseur-eng"]
    row[DESC["awards"]] = f"Services from {name}. " + WORDS * 10
    row[DESC_FR["awards"]] = f"Services de {name}."
    path = tmp_path / "p.csv"
    path.write_bytes(csv_bytes(header, [row]))
    canadabuys.load_file(conn, "awards", path, "fy.csv", now="2026-11-10T13:00:00Z")
    got = conn.execute("SELECT * FROM awards WHERE reference = 'cb-000-00000001'").fetchone()
    assert got["supplier_withheld"] == 1
    assert got["description_en"].startswith("Services from [name withheld].") and name not in got["description_en"]
    assert got["description_en_cut"] == DESCRIPTION_MAX and len(got["description_en"]) <= DESCRIPTION_MAX
    assert (got["description_fr"], got["description_fr_cut"]) == ("Services de [nom retiré].", 0)


# -- the first run after the change ------------------------------------------------------


class ConditionalSession:
    """Serves each URL's bytes, answering 304 to a request that carries the validators it last sent."""

    def __init__(self, bodies: dict[str, bytes], headers: dict[str, dict[str, str]]) -> None:
        self.bodies, self.headers = bodies, headers
        self.calls: list[tuple[str, dict]] = []

    def mount(self, prefix, adapter):
        pass

    def get(self, url, headers=None, timeout=None, stream=False):
        self.calls.append((url, headers or {}))
        if url not in self.bodies:
            return FakeResponse(404)
        sent = self.headers.get(url, {})
        if (headers or {}).get("If-None-Match") == sent.get("ETag") and sent.get("ETag"):
            return FakeResponse(304)
        return FakeResponse(200, self.bodies[url], sent)


def client_for(session, tmp_path) -> PoliteClient:
    return PoliteClient(session=session, cache_dir=tmp_path / "cache", sleep=lambda s: None, clock=lambda: 0.0)


def old_cut(value: object, limit: int) -> tuple[str | None, None]:
    """The loader before the cut was recorded: the first 600 characters, cut wherever they ended, nothing noted."""
    text = normalized(str(value or ""))
    return (text[:UNMARKED_DESCRIPTION_MAX].rstrip() or None), None


def old_database(path, monkeypatch, nights):
    """A database written under the old rule: each night of nights run by the old loader, then the cut columns
    and the rule's record dropped, as a database from before the change holds them."""
    conn = connect(path)
    with monkeypatch.context() as m:
        m.setattr(canadabuys_rows, "description", old_cut)
        for night in nights:
            night(conn)
    for table in ("tenders", "awards", "contract_history"):
        for column in ("description_en_cut", "description_fr_cut"):
            conn.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
    conn.execute("DELETE FROM meta WHERE key LIKE 'canadabuys:%:description_rule'")
    conn.commit()
    conn.close()
    return path


def test_the_first_run_after_the_change_reads_the_tender_complete_file_again_and_rewrites_every_notice(
        fixtures, tmp_path, monkeypatch):
    header, rows = read_csv(fixtures / FILES["tenders"])
    files = canadabuys.files_for("tenders", datetime(2026, 11, 10).date())
    complete = csv_bytes(header, rows)
    bodies = {files["complete"].url: complete, files["new"].url: csv_bytes(header, rows[:3]),
              files["open"].url: csv_bytes(header, rows[:10])}
    stamped = {"ETag": '"v1"', "Last-Modified": "Tue, 10 Nov 2026 11:00:00 GMT"}
    session = ConditionalSession(bodies, {url: stamped for url in bodies})

    def night(conn):
        canadabuys.run(conn, client_for(session, tmp_path), "tenders", now="2026-11-10T13:00:00Z",
                       work_dir=tmp_path / "work")

    path = old_database(tmp_path / "old.sqlite", monkeypatch, [night])
    # As the old loader stored them: the first 600 characters, most of them ending inside a word.
    raw = sqlite3.connect(path)
    assert "description_en_cut" not in {r[1] for r in raw.execute("PRAGMA table_info(tenders)")}
    assert raw.execute("SELECT MAX(length(description_en)) FROM tenders").fetchone()[0] <= 600
    assert raw.execute("SELECT COUNT(*) FROM tenders WHERE length(description_en) >= 590").fetchone()[0] == 15
    raw.close()

    conn = connect(path)  # the columns come back empty: no row records a cut yet
    assert conn.execute("SELECT COUNT(*) FROM tenders WHERE description_en_cut IS NOT NULL").fetchone()[0] == 0
    # The complete file is not due for six more days, and its copy has not changed.
    assert get_meta(conn, f"canadabuys:{files['complete'].name}:sha256") == hashlib.sha256(complete).hexdigest()
    assert not canadabuys.complete_due(conn, files["complete"].name, datetime(2026, 11, 11, 13, tzinfo=timezone.utc))
    assert canadabuys.description_rule_due(conn, "tenders")
    assert [f.kind for f in canadabuys.plan(conn, "tenders", datetime(2026, 11, 11, 13, tzinfo=timezone.utc))] == \
        ["complete", "new", "open"]

    calls = len(session.calls)
    stats = canadabuys.run(conn, client_for(session, tmp_path), "tenders", now="2026-11-11T13:00:00Z",
                           work_dir=tmp_path / "work")
    assert files["complete"].name in stats.read
    sent = dict(session.calls[calls:])
    # Asked for without its validators, and parsed though its checksum is the one last read.
    assert "If-None-Match" not in sent[files["complete"].url]
    assert get_meta(conn, canadabuys.description_rule_key("tenders")) == canadabuys.description_rule("tenders")
    en, fr = by_version(rows, DESC["tenders"]), by_version(rows, DESC_FR["tenders"])
    stored = conn.execute("SELECT reference, amendment, description_en, description_fr, description_en_cut, "
                          "description_fr_cut FROM tenders").fetchall()
    assert len(stored) == len(en)
    for r in stored:
        key = (r["reference"], r["amendment"])
        for text, cut, whole in ((r["description_en"], r["description_en_cut"], en[key]),
                                 (r["description_fr"], r["description_fr_cut"], fr[key])):
            if not whole:
                assert text is None and cut is None
            elif len(whole) <= TENDER_DESCRIPTION_MAX:
                assert (text, cut) == (whole, 0)
            else:
                assert cut == TENDER_DESCRIPTION_MAX and whole.startswith(text) and whole[len(text)].isspace()
    assert conn.execute("SELECT COUNT(*) FROM tenders WHERE length(description_en) > 600").fetchone()[0] == 15

    # The next night the rule is current: the complete file waits for its week, and only its validators are new.
    calls = len(session.calls)
    later = canadabuys.run(conn, client_for(session, tmp_path), "tenders", now="2026-11-12T13:00:00Z",
                           work_dir=tmp_path / "work")
    assert files["complete"].url not in dict(session.calls[calls:])
    assert files["complete"].name not in later.read
    conn.close()


def test_award_notices_keep_their_rows_until_their_files_come_round(fixtures, tmp_path, monkeypatch):
    """Awards keep 600 characters, so no file is read early for them: the fiscal-year file read tonight
    records its rows' cut, and a row only the legacy file holds keeps none (the site reads it by its length)."""
    header, rows = read_csv(fixtures / FILES["awards"])
    files = canadabuys.files_for("awards", datetime(2026, 11, 10).date())
    legacy_only = dict(rows[0])
    legacy_only[REF] = "PW-LEGACY-1"
    legacy_only[DESC["awards"]] = WORDS * 10
    fy = csv_bytes(header, rows)
    bodies = {files["legacy"].url: csv_bytes(header, [*rows, legacy_only]), files["complete"].url: fy,
              files["fy"].url: fy}
    stamped = {"ETag": '"v1"', "Last-Modified": "Tue, 10 Nov 2026 11:00:00 GMT"}
    session = ConditionalSession(bodies, {url: stamped for url in bodies})

    def night(conn):
        canadabuys.run(conn, client_for(session, tmp_path), "awards", now="2026-11-10T13:00:00Z",
                       work_dir=tmp_path / "work")

    path = old_database(tmp_path / "old.sqlite", monkeypatch, [night])
    conn = connect(path)
    assert not canadabuys.description_rule_due(conn, "awards")
    when = datetime(2026, 11, 11, 13, tzinfo=timezone.utc)
    assert [f.kind for f in canadabuys.plan(conn, "awards", when)] == ["fy"]
    # Tonight's fiscal-year file has changed.
    session.bodies[files["fy"].url] = csv_bytes(header, rows[::-1])
    session.headers[files["fy"].url] = {"ETag": '"v2"', "Last-Modified": "Wed, 11 Nov 2026 11:00:00 GMT"}
    stats = canadabuys.run(conn, client_for(session, tmp_path), "awards", now="2026-11-11T13:00:00Z",
                           work_dir=tmp_path / "work")
    assert stats.read == [files["fy"].name]
    marked = {r[0] for r in conn.execute("SELECT reference FROM awards WHERE description_en_cut IS NOT NULL "
                                         "OR description_fr_cut IS NOT NULL")}
    assert marked == {r[REF] for r in rows}
    legacy = conn.execute("SELECT description_en, description_en_cut FROM awards WHERE reference = 'PW-LEGACY-1'").fetchone()
    assert legacy["description_en_cut"] is None and 590 <= len(legacy["description_en"]) <= 600
    long = conn.execute("SELECT description_en, description_en_cut FROM awards WHERE description_en_cut > 0").fetchall()
    assert long and all(r["description_en_cut"] == DESCRIPTION_MAX and len(r["description_en"]) <= 600 for r in long)
    conn.close()


# -- the export ------------------------------------------------------------------------------


BASE = "https://awardwatch.example"


def detail(out, folder, key):
    return json.loads((out / folder / f"{es.reference_shard(key.split(':')[-1])}.json").read_text(encoding="utf-8"))[key]


def test_the_detail_carries_the_cut_only_for_a_row_that_records_one(conn, tmp_path):
    seed(conn)
    tender(conn, "cb-cut", 0, title="Long notice")
    tender(conn, "cb-whole", 0, title="Short notice")
    award(conn, "AW-CUT", 0, "Acme Inc.", value=1000.0)
    conn.execute("UPDATE tenders SET description_en = ?, description_en_cut = ?, description_fr = ?, "
                 "description_fr_cut = 0 WHERE reference = 'cb-cut'", ("Start of a longer text", TENDER_DESCRIPTION_MAX,
                                                                       "Texte complet."))
    conn.execute("UPDATE tenders SET description_en_cut = 0 WHERE reference = 'cb-whole'")
    conn.execute("UPDATE awards SET description_en = 'Start', description_en_cut = 600, description_fr = 'Début', "
                 "description_fr_cut = 600 WHERE reference = 'AW-CUT'")
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    assert detail(out, "tenders", "cb-cut")["description_cut"] == {"en": TENDER_DESCRIPTION_MAX}
    assert detail(out, "tenders", "cb-whole")["description_cut"] == {}
    assert detail(out, "contracts", "award:aw-cut")["description_cut"] == {"en": 600, "fr": 600}
    # A row stored before the cut was recorded: no mark, and the site reads its length as before.
    assert "description_cut" not in detail(out, "tenders", "cb-100-1")
    assert "description_cut" not in detail(out, "contracts", "award:aw-1")
    # The API passes the tender detail through, so the mark travels with the text; nothing else carries it.
    assert not any("description_cut" in r for r in json.loads((out / "tenders" / "open.json").read_text(encoding="utf-8")))


def test_a_tender_shard_past_the_workers_parse_size_is_logged(conn, tmp_path, monkeypatch, caplog):
    seed(conn)
    monkeypatch.setattr(es, "TENDER_SHARD_WARN", 100)
    with caplog.at_level(logging.WARNING, logger=es.log.name):
        counts = es.export_static(conn, tmp_path / "static", today=TODAY, base_url=BASE)
    assert counts["tender_shards_over_300kb"] >= 1 and counts["tender_shard_max_bytes"] > 100
    assert any("tender shards above" in r.getMessage() for r in caplog.records)
    monkeypatch.setattr(es, "TENDER_SHARD_WARN", 300 * 1024)
    assert es.export_static(conn, tmp_path / "again", today=TODAY, base_url=BASE)["tender_shards_over_300kb"] == 0
