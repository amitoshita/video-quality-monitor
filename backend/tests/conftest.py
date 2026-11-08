import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import Settings
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parent.parent
FRONTEND_ORIGIN = "http://localhost:5173"

# Set in CI to run the whole suite against real Postgres as well as SQLite.
POSTGRES_URL = os.environ.get("TEST_DATABASE_URL")


def make_settings(database_url: str, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": database_url,
        "cors_origins": FRONTEND_ORIGIN,
        "min_fps": 15,
        "min_brightness": 60,
        "max_brightness": 200,
        "max_motion": 20,
        "max_batch_size": 120,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def migrate(database_url: str, revision: str = "head") -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    config.attributes["configure_logger"] = False
    command.upgrade(config, revision)


@pytest.fixture(scope="session")
def migrated_postgres() -> str | None:
    if POSTGRES_URL is None:
        return None
    url = make_settings(POSTGRES_URL).database_url  # normalised to psycopg 3
    migrate(url)
    return url


@pytest.fixture
def database_url(tmp_path: Path, migrated_postgres: str | None) -> str:
    if migrated_postgres is not None:
        engine = create_engine(migrated_postgres)
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE sessions CASCADE"))
        engine.dispose()
        return migrated_postgres
    url = f"sqlite:///{tmp_path / 'test.db'}"
    migrate(url)
    return url


@pytest.fixture
def settings(database_url: str) -> Settings:
    return make_settings(database_url)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def sample(t: int, **overrides: Any) -> dict[str, Any]:
    """A valid 'good' sample; override fields to build other cases."""
    value: dict[str, Any] = {
        "t": t,
        "fps": 30.0,
        "brightness": 120.0,
        "motion": 2.5,
        "face": True,
        "verdict": "good",
        "reason": None,
    }
    value.update(overrides)
    return value


def poor(t: int, reason: str, **overrides: Any) -> dict[str, Any]:
    return sample(t, verdict="poor", reason=reason, **overrides)


def new_session(client: TestClient) -> str:
    response = client.post("/sessions")
    assert response.status_code == 201
    session_id: str = response.json()["id"]
    return session_id


def post_samples(client: TestClient, session_id: str, samples: list[dict[str, Any]]) -> Any:
    return client.post(f"/sessions/{session_id}/samples", json={"samples": samples})
