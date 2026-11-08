import uuid
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, func, inspect, select

from app.db import make_engine, make_session_factory
from app.models import Sample, Session
from tests.conftest import BACKEND_DIR, migrate


def test_migration_upgrades_and_downgrades_cleanly(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'm.db'}"
    migrate(url)
    assert {"sessions", "samples"} <= set(inspect(create_engine(url)).get_table_names())

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    config.attributes["configure_logger"] = False
    command.downgrade(config, "base")

    assert set(inspect(create_engine(url)).get_table_names()) == {"alembic_version"}


def test_deleting_a_session_cascades_to_samples(database_url: str) -> None:
    factory = make_session_factory(make_engine(database_url))
    with factory() as db:
        session = Session(id=uuid.uuid4(), started_at=datetime.now(UTC))
        db.add(session)
        db.flush()
        db.add(
            Sample(
                session_id=session.id,
                t=1,
                fps=30,
                brightness=1,
                motion=1,
                face=True,
                verdict="good",
                reason=None,
            )
        )
        db.commit()

        db.delete(session)
        db.commit()

        assert db.scalar(select(func.count()).select_from(Sample)) == 0
