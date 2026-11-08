import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session as DbSession

from app import repository
from app.config import Settings
from app.db import get_db
from app.errors import ApiError, session_not_found
from app.schemas import (
    IngestResult,
    PublicConfig,
    SampleOut,
    SamplesBatch,
    SessionDetail,
    SessionList,
    SessionOut,
    SessionWithSummary,
    Thresholds,
)

router = APIRouter()

Db = Annotated[DbSession, Depends(get_db)]


def get_settings_from_app(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


AppSettings = Annotated[Settings, Depends(get_settings_from_app)]


def parse_session_id(session_id: str) -> uuid.UUID:
    # A malformed id can't match any session, so it gets the same 404 as an unknown one.
    try:
        return uuid.UUID(session_id)
    except ValueError:
        raise session_not_found() from None


SessionId = Annotated[uuid.UUID, Depends(parse_session_id)]


@router.get("/healthz")
def healthz() -> dict[str, str]:
    # Deliberately no DB call: this is the wake-up / liveness ping.
    return {"status": "ok"}


@router.get("/config")
def public_config(settings: AppSettings) -> PublicConfig:
    return PublicConfig(
        thresholds=Thresholds(
            min_fps=settings.min_fps,
            min_brightness=settings.min_brightness,
            max_brightness=settings.max_brightness,
            max_motion=settings.max_motion,
        ),
        max_batch_size=settings.max_batch_size,
    )


@router.post("/sessions", status_code=201)
def create_session(db: Db) -> SessionOut:
    return SessionOut.model_validate(repository.create_session(db))


@router.post("/sessions/{session_id}/samples")
def ingest_samples(
    session_id: SessionId, batch: SamplesBatch, db: Db, settings: AppSettings
) -> IngestResult:
    if len(batch.samples) > settings.max_batch_size:
        raise ApiError(
            422,
            "batch_too_large",
            f"At most {settings.max_batch_size} samples per request",
        )
    return repository.ingest_samples(db, session_id, batch.samples)


@router.post("/sessions/{session_id}/stop")
def stop_session(session_id: SessionId, db: Db) -> SessionOut:
    return SessionOut.model_validate(repository.stop_session(db, session_id))


@router.get("/sessions")
def list_sessions(
    db: Db,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SessionList:
    items, total = repository.list_sessions(db, limit=limit, offset=offset)
    return SessionList(
        items=[
            SessionWithSummary(**SessionOut.model_validate(s).model_dump(), summary=summary)
            for s, summary in items
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/sessions/{session_id}")
def get_session(session_id: SessionId, db: Db) -> SessionDetail:
    session, summary, samples = repository.get_session_detail(db, session_id)
    return SessionDetail(
        **SessionOut.model_validate(session).model_dump(),
        summary=summary,
        samples=[SampleOut.model_validate(s) for s in samples],
    )
