"""All SQL lives here. Routes call these functions and never build queries themselves."""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import Row, case, func, select, update
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session as DbSession

from app.errors import session_not_found
from app.models import Sample, Session
from app.schemas import IngestResult, SampleIn, Summary


def create_session(db: DbSession) -> Session:
    session = Session(id=uuid.uuid4(), started_at=datetime.now(UTC), ended_at=None)
    db.add(session)
    db.commit()
    return session


def get_session(db: DbSession, session_id: uuid.UUID, *, for_update: bool = False) -> Session:
    query = select(Session).where(Session.id == session_id)
    if for_update:
        # Postgres: serialises ingest against stop for this session. SQLite ignores it (and
        # only has one writer at a time anyway).
        query = query.with_for_update()
    session = db.scalars(query).one_or_none()
    if session is None:
        raise session_not_found()
    return session


def ingest_samples(
    db: DbSession, session_id: uuid.UUID, samples: Sequence[SampleIn]
) -> IngestResult:
    """Store samples idempotently. The first write for a given (session_id, t) wins.

    - Duplicate t inside one batch: the first occurrence is kept, the rest count as duplicates.
    - t already stored: counted as a duplicate (a resend after a lost response).
    - Session already stopped: new t values are not stored and are reported in
      ignored_after_stop, so an ended session never changes.
    """
    session = get_session(db, session_id, for_update=True)

    unique: dict[int, SampleIn] = {}
    for sample in samples:
        unique.setdefault(sample.t, sample)
    in_batch_duplicates = len(samples) - len(unique)

    if session.ended_at is not None:
        stored = set(
            db.scalars(
                select(Sample.t).where(Sample.session_id == session_id, Sample.t.in_(unique))
            )
        )
        db.rollback()  # release the row lock; nothing to write
        return IngestResult(
            accepted=0,
            duplicates=in_batch_duplicates + len(stored),
            ignored_after_stop=len(unique) - len(stored),
        )

    rows = [{"session_id": session_id, **s.model_dump()} for s in unique.values()]
    insert = postgresql.insert if db.get_bind().dialect.name == "postgresql" else sqlite.insert
    statement = (
        insert(Sample)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["session_id", "t"])
        .returning(Sample.t)
    )
    accepted = len(db.scalars(statement).all())
    db.commit()
    return IngestResult(accepted=accepted, duplicates=len(samples) - accepted, ignored_after_stop=0)


def stop_session(db: DbSession, session_id: uuid.UUID) -> Session:
    """Idempotent: only the first call sets ended_at; later calls return the same value."""
    db.execute(
        update(Session)
        .where(Session.id == session_id, Session.ended_at.is_(None))
        .values(ended_at=datetime.now(UTC))
    )
    db.commit()
    return get_session(db, session_id)


def _summary_columns() -> tuple[Any, ...]:
    # CASE without ELSE yields NULL for the LEFT JOIN's placeholder row, so a session with no
    # samples averages to NULL instead of 0.
    return (
        func.count(Sample.t).label("sample_count"),
        func.max(Sample.t).label("last_t"),
        func.avg(Sample.fps).label("avg_fps"),
        func.avg(case((Sample.face.is_(True), 100.0), (Sample.face.is_(False), 0.0))).label(
            "face_pct"
        ),
        func.avg(case((Sample.verdict == "good", 100.0), (Sample.verdict == "poor", 0.0))).label(
            "good_pct"
        ),
    )


def _round1(value: float | Decimal | None) -> float | None:
    """Round half-up to one decimal (Python's round() is banker's rounding)."""
    if value is None:
        return None
    return float(Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _to_summary(row: Row[Any]) -> Summary:
    return Summary(
        duration_s=row.last_t or 0,
        sample_count=row.sample_count,
        avg_fps=_round1(row.avg_fps),
        face_pct=_round1(row.face_pct),
        good_pct=_round1(row.good_pct),
    )


def list_sessions(
    db: DbSession, *, limit: int, offset: int
) -> tuple[list[tuple[Session, Summary]], int]:
    """Newest first, each with its summary, in one aggregate query (no N+1)."""
    query = (
        select(Session, *_summary_columns())
        .outerjoin(Sample, Sample.session_id == Session.id)
        .group_by(Session.id)
        .order_by(Session.started_at.desc(), Session.id)
        .limit(limit)
        .offset(offset)
    )
    items = [(row.Session, _to_summary(row)) for row in db.execute(query)]
    total = db.scalar(select(func.count()).select_from(Session)) or 0
    return items, total


def get_session_detail(
    db: DbSession, session_id: uuid.UUID
) -> tuple[Session, Summary, list[Sample]]:
    session = get_session(db, session_id)
    summary_row = db.execute(
        select(*_summary_columns()).where(Sample.session_id == session_id)
    ).one()
    samples = list(
        db.scalars(select(Sample).where(Sample.session_id == session_id).order_by(Sample.t))
    )
    return session, _to_summary(summary_row), samples
