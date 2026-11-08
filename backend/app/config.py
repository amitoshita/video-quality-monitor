from functools import lru_cache
from typing import Annotated, Self

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration, read from environment variables (or backend/.env locally).

    Thresholds have no defaults on purpose: the app refuses to start without them, so the
    values in use are always the ones written down in the environment.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    database_url: str
    cors_origins: Annotated[list[str], NoDecode]

    min_fps: float = Field(ge=0, le=120)
    min_brightness: float = Field(ge=0, le=255)
    max_brightness: float = Field(ge=0, le=255)
    max_motion: float = Field(ge=0, le=255)

    max_batch_size: int = Field(default=120, ge=1, le=1000)
    log_level: str = "INFO"

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        # Neon (and most hosts) hand out postgres:// or postgresql:// URLs; SQLAlchemy would
        # pick psycopg2 for those, but we ship psycopg 3.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value.removeprefix(prefix)
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def no_wildcard(cls, origins: list[str]) -> list[str]:
        if not origins:
            raise ValueError("at least one origin is required")
        if "*" in origins:
            raise ValueError("wildcard origin is not allowed; list exact origins")
        return origins

    @model_validator(mode="after")
    def brightness_range_is_ordered(self) -> Self:
        if self.min_brightness >= self.max_brightness:
            raise ValueError("MIN_BRIGHTNESS must be lower than MAX_BRIGHTNESS")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
