import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Dialect,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    TypeDecorator,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.domain import REASONS, VERDICTS


class UTCDateTime(TypeDecorator[datetime]):
    """Timezone-aware UTC timestamps on every backend.

    Postgres keeps the offset in timestamptz; SQLite has no timezone type and returns naive
    values, so we normalise on the way in and re-attach UTC on the way out.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetimes are not allowed")
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _sql_in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    __table_args__ = (Index("ix_sessions_started_at", started_at.desc()),)


class Sample(Base):
    __tablename__ = "samples"

    # (session_id, t) is the primary key: it is the idempotency key for resent samples, and
    # its index also serves "samples of a session ordered by t".
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True
    )
    t: Mapped[int] = mapped_column(Integer, primary_key=True)
    fps: Mapped[float] = mapped_column(Float)
    brightness: Mapped[float | None] = mapped_column(Float)
    motion: Mapped[float | None] = mapped_column(Float)
    face: Mapped[bool] = mapped_column(Boolean)
    verdict: Mapped[str] = mapped_column(String(8))
    reason: Mapped[str | None] = mapped_column(String(16))

    __table_args__ = (
        CheckConstraint(f"verdict IN ({_sql_in(VERDICTS)})", name="verdict"),
        CheckConstraint(f"reason IS NULL OR reason IN ({_sql_in(REASONS)})", name="reason"),
        CheckConstraint(
            "(verdict = 'good' AND reason IS NULL) OR (verdict = 'poor' AND reason IS NOT NULL)",
            name="reason_matches_verdict",
        ),
    )
