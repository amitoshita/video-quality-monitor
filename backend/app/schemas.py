import uuid
from datetime import datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain import MAX_T_SECONDS, Reason, Verdict


class SampleFields(BaseModel):
    t: int = Field(ge=0, le=MAX_T_SECONDS, description="Whole seconds since session start")
    fps: float = Field(ge=0, le=120)
    # Nullable but required: null means "not measurable this second" (see SampleIn rules).
    brightness: float | None = Field(ge=0, le=255)
    motion: float | None = Field(ge=0, le=255)
    face: bool
    verdict: Verdict
    reason: Reason | None


class SampleIn(SampleFields):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    @model_validator(mode="after")
    def check_consistency(self) -> Self:
        if (self.verdict == "good") != (self.reason is None):
            raise ValueError("reason must be null when verdict is 'good' and set when 'poor'")
        if self.fps == 0 and (self.brightness is not None or self.motion is not None):
            raise ValueError("a second with no processed frames has no brightness or motion")
        if self.fps > 0 and self.brightness is None:
            raise ValueError("brightness is required when frames were processed")
        return self


class SamplesBatch(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    # The upper bound comes from configuration and is checked in the route.
    samples: list[SampleIn] = Field(min_length=1)


class SampleOut(SampleFields):
    model_config = ConfigDict(from_attributes=True)


class IngestResult(BaseModel):
    accepted: int
    duplicates: int
    ignored_after_stop: int


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None


class Summary(BaseModel):
    duration_s: int = Field(description="t of the last sample; 0 when there are no samples")
    sample_count: int
    avg_fps: float | None
    face_pct: float | None
    good_pct: float | None


class SessionWithSummary(SessionOut):
    summary: Summary


class SessionDetail(SessionWithSummary):
    samples: list[SampleOut]


class SessionList(BaseModel):
    items: list[SessionWithSummary]
    total: int
    limit: int
    offset: int


class Thresholds(BaseModel):
    min_fps: float
    min_brightness: float
    max_brightness: float
    max_motion: float


class PublicConfig(BaseModel):
    thresholds: Thresholds
    max_batch_size: int
