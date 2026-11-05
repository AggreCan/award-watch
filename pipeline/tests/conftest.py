from __future__ import annotations

from pathlib import Path

import pytest

from awardwatch_pipeline import config
from awardwatch_pipeline.db import connect
from awardwatch_pipeline.http import PoliteClient

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class FakeResponse:
    def __init__(self, status: int, content: bytes = b"", headers: dict | None = None) -> None:
        self.status_code = status
        self.content = content
        self.headers = headers or {}


class FakeSession:
    """Serves bytes by exact URL; anything else is a 404. Records every call."""

    def __init__(self, mapping: dict[str, bytes | FakeResponse]) -> None:
        self.mapping = mapping
        self.calls: list[tuple[str, dict]] = []

    def get(self, url: str, headers: dict | None = None, timeout: float | None = None, stream: bool = False) -> FakeResponse:
        self.calls.append((url, headers or {}))
        value = self.mapping.get(url)
        if value is None:
            return FakeResponse(404)
        if isinstance(value, FakeResponse):
            return value
        return FakeResponse(200, value)


@pytest.fixture(autouse=True)
def out_dir(tmp_path, monkeypatch):
    # Nothing a test runs writes into the repository's data/out (the review
    # lists of withheld names go there in a real run), and no stage reads a
    # seed copy the operator left in the repository's data/seeds.
    monkeypatch.setattr(config, "OUT_DIR", tmp_path / "out")
    monkeypatch.setattr(config, "SEEDS_DIR", tmp_path / "seeds")
    return tmp_path / "out"


@pytest.fixture
def conn():
    c = connect(memory=True)
    yield c
    c.close()


@pytest.fixture
def fixtures() -> Path:
    return FIXTURES


@pytest.fixture
def fake_client(tmp_path):
    def make(mapping: dict[str, bytes | FakeResponse], **kwargs) -> PoliteClient:
        session = FakeSession(mapping)
        client = PoliteClient(
            session=session, cache_dir=tmp_path / "cache", sleep=lambda s: None,
            clock=lambda: 0.0, **kwargs,
        )
        client.fake_session = session  # type: ignore[attr-defined]
        return client

    return make
