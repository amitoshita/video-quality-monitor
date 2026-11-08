from collections.abc import Iterator
from typing import Any

from fastapi import Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker


def make_engine(database_url: str) -> Engine:
    if database_url.startswith("sqlite"):
        engine = create_engine(database_url, connect_args={"check_same_thread": False})

        @event.listens_for(engine, "connect")
        def enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
            # SQLite ignores ON DELETE CASCADE unless this is on, per connection.
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return engine

    return create_engine(
        database_url,
        # Neon suspends idle compute; a stale pooled connection must be replaced, not 500.
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=3,
        pool_recycle=300,
        # Neon's pooled endpoint is PgBouncer in transaction mode, where server-side prepared
        # statements can land on another backend; psycopg's auto-prepare is switched off.
        connect_args={"prepare_threshold": None},
    )


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_db(request: Request) -> Iterator[Session]:
    factory: sessionmaker[Session] = request.app.state.session_factory
    with factory() as db:
        yield db
