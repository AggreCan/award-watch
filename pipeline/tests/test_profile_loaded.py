"""A profile says when a source has never been read, so the site shows "not loaded yet" rather than 0."""

import json

from awardwatch_pipeline import export_static as es
from awardwatch_pipeline import organizations
from export_seed import ACME, TODAY, seed

BASE = "https://awardwatch.example"


def profiles(out):
    found = {}
    for path in (out / "profiles").glob("*.json"):
        found.update(json.loads(path.read_text(encoding="utf-8")))
    return found


def test_a_source_never_read_is_marked_on_every_profile(conn, tmp_path):
    ids = seed(conn)
    conn.execute("DELETE FROM lobbying_communications")
    conn.execute("DELETE FROM contracts")
    # The contracts file was read and held no row for anyone: loaded, with nothing in it.
    conn.execute("INSERT INTO meta (key, value) VALUES ('contracts:sha256', 'x')")
    organizations.recompute(conn, now="2026-10-31T02:00:00Z")
    assert es.sources_loaded(conn) == {"awards": True, "history": True, "contracts": True, "grants": True,
                                       "lobbying": False}
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    acme = profiles(out)[ids[ACME]]
    assert acme["lobbying_loaded"] is False and acme["lobbying"] == [] and acme["lobbying_total_rows"] == 0
    assert acme["organization"]["n_lobbying"] == 0
    assert not any(k.endswith("_loaded") for k in acme if k != "lobbying_loaded")


def test_a_read_source_carries_no_marker(conn, tmp_path):
    ids = seed(conn)
    conn.execute("DELETE FROM lobbying_communications")
    conn.execute("INSERT INTO meta (key, value) VALUES ('lobbying:read_at', '2026-10-31T00:00:00Z')")
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    assert not any(k.endswith("_loaded") for p in profiles(out).values() for k in p)
